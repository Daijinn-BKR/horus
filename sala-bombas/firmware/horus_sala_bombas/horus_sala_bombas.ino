/*
 * Omega Eléctrica — Módulo de monitoreo Sala de Bombas
 * ESP32 + DHT22 (temp/humedad) + BMP280 (presión/temp) + PIR HC-SR501 (movimiento)
 *
 * Envía lecturas periódicas (y eventos de movimiento inmediatos) por HTTPS
 * directo a Supabase (sistema Horus): POST /rest/v1/rpc/registrar_lectura
 *
 * Librerías (Arduino IDE > Gestor de librerías):
 *   - "DHT sensor library" (Adafruit)  + "Adafruit Unified Sensor"
 *   - "Adafruit BMP280 Library"
 *   - "ArduinoJson" (Benoit Blanchon) v7
 * Placa: "ESP32 Dev Module" (paquete esp32 de Espressif)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_BMP280.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include "config.h"

DHT dht(PIN_DHT, DHT22);
Adafruit_BMP280 bmp;
bool bmpOk = false;

volatile bool movimientoDetectado = false;   // se activa en la interrupción
volatile unsigned long ultimoMovimientoMs = 0;
bool ultimoEstadoPIR = false;

unsigned long ultimoEnvio = 0;
unsigned long arranqueMs = 0;
const unsigned long CALENTAMIENTO_PIR_MS = 60000UL;  // el HC-SR501 necesita ~1 min al encender

void IRAM_ATTR isrPIR() {
  movimientoDetectado = true;
  ultimoMovimientoMs = millis();
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Conectando a WiFi '%s'", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset();
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi OK. IP: %s  RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("\nNo se pudo conectar; se reintentará.");
  }
}

// Punto de rocío (fórmula de Magnus): útil en sala de bombas para anticipar condensación
float puntoRocio(float t, float h) {
  const float a = 17.62, b = 243.12;
  float g = (a * t) / (b + t) + log(h / 100.0);
  return (b * g) / (a - g);
}

bool enviar(const char* motivo) {
  conectarWiFi();
  if (WiFi.status() != WL_CONNECTED) return false;

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  float p = NAN, tBmp = NAN;
  if (bmpOk) {
    p = bmp.readPressure() / 100.0F;  // Pa -> hPa
    tBmp = bmp.readTemperature();
  }

  bool calentando = millis() - arranqueMs < CALENTAMIENTO_PIR_MS;
  bool mov = !calentando && (movimientoDetectado || digitalRead(PIN_PIR) == HIGH);

  JsonDocument doc;
  doc["p_dispositivo"] = DEVICE_ID;
  doc["p_clave"] = DEVICE_KEY;
  JsonObject d = doc["p_datos"].to<JsonObject>();
  d["motivo"] = motivo;                   // "periodico" | "movimiento"
  if (!isnan(t)) d["temperatura"] = round(t * 10) / 10.0;
  if (!isnan(h)) d["humedad"] = round(h * 10) / 10.0;
  if (!isnan(t) && !isnan(h)) d["punto_rocio"] = round(puntoRocio(t, h) * 10) / 10.0;
  if (!isnan(p)) d["presion"] = round(p * 10) / 10.0;
  if (!isnan(tBmp)) d["temperatura_bmp"] = round(tBmp * 10) / 10.0;
  d["movimiento"] = mov;
  d["pir_calentando"] = calentando;
  d["rssi"] = WiFi.RSSI();
  d["uptime_s"] = millis() / 1000;
  JsonArray errores = d["errores"].to<JsonArray>();
  if (isnan(t) || isnan(h)) errores.add("DHT22");
  if (!bmpOk || isnan(p)) errores.add("BMP280");

  String cuerpo;
  serializeJson(doc, cuerpo);

  // HTTPS. setInsecure() cifra la conexión pero no valida el certificado del servidor
  // (evita tener que actualizar certificados en el ESP32). La clave del módulo protege los datos.
  WiFiClientSecure cliente;
  cliente.setInsecure();
  HTTPClient http;
  http.begin(cliente, String(SUPABASE_URL) + "/rest/v1/rpc/registrar_lectura");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.setTimeout(8000);
  int codigo = http.POST(cuerpo);
  if (codigo >= 400) Serial.printf("Respuesta: %s\n", http.getString().c_str());
  http.end();

  Serial.printf("[%s] HTTP %d\n", motivo, codigo);  // (no se imprime el cuerpo: lleva la clave)
  if (codigo >= 200 && codigo < 300) {
    movimientoDetectado = false;  // se limpia solo si el servidor recibió el dato
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== Omega Eléctrica - Sala de Bombas ===");

  // Watchdog: reinicia el ESP32 si se cuelga más de 30 s
  esp_task_wdt_config_t wdt = { .timeout_ms = 30000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&wdt);
  esp_task_wdt_add(NULL);

  dht.begin();
  Wire.begin(21, 22);
  bmpOk = bmp.begin(0x76) || bmp.begin(0x77);
  Serial.println(bmpOk ? "BMP280 OK" : "BMP280 NO detectado (revisa SDA/SCL y dirección)");
  if (bmpOk) {
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL, Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16, Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
  }

  pinMode(PIN_PIR, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_PIR), isrPIR, RISING);

  arranqueMs = millis();
  conectarWiFi();
  Serial.println("PIR en calentamiento (60 s)...");
}

void loop() {
  esp_task_wdt_reset();
  unsigned long ahora = millis();

  // Evento de movimiento: se avisa de inmediato (máx. 1 aviso cada 5 s)
  bool calentando = ahora - arranqueMs < CALENTAMIENTO_PIR_MS;
  bool pirActual = digitalRead(PIN_PIR) == HIGH;
  if (!calentando && pirActual && !ultimoEstadoPIR && ahora - ultimoEnvio > 5000) {
    if (enviar("movimiento")) ultimoEnvio = ahora;
  }
  ultimoEstadoPIR = pirActual;

  // Envío periódico
  if (ahora - ultimoEnvio >= INTERVALO_MS) {
    enviar("periodico");
    ultimoEnvio = ahora;  // aunque falle, espera al próximo ciclo
  }

  delay(100);
}

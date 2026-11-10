/*
 * Prueba del DHT22 - Omega Eléctrica
 * Carga este programa, abre el Monitor Serie a 115200 y revisa los mensajes.
 * Cuando termines, vuelve a cargar omega_sala_bombas.ino.
 */
#include <DHT.h>

#define PIN_DHT 4

DHT dht22(PIN_DHT, DHT22);
DHT dht11(PIN_DHT, DHT11);

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== PRUEBA DHT22 ===");

  // 1) Con el sensor alimentado, la resistencia del módulo deja el pin DAT en ALTO (1)
  pinMode(PIN_DHT, INPUT_PULLDOWN);
  delay(50);
  int nivel = digitalRead(PIN_DHT);
  Serial.printf("Paso 1 - Nivel del pin DAT en reposo: %d\n", nivel);
  if (nivel == 1) {
    Serial.println("  OK: el modulo recibe energia y el cable DAT llega al pin 4.");
  } else {
    Serial.println("  FALLA: el pin 4 no ve el modulo. Revisa:");
    Serial.println("   - que el riel izquierdo + tenga 3.3V (cable desde 3V3 del ESP32)");
    Serial.println("   - que el GND del modulo llegue al riel -");
    Serial.println("   - que el cable DAT este en el pin marcado 4 del ESP32");
    Serial.println("   - que los pines del modulo esten bien insertados en E35-E37");
  }

  dht22.begin();
  delay(2500);  // el DHT22 necesita ~2 s tras encender
}

void loop() {
  float t = dht22.readTemperature();
  float h = dht22.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    Serial.printf("Paso 2 - DHT22 OK: %.1f C  %.1f %%\n", t, h);
  } else {
    Serial.println("Paso 2 - DHT22 sin respuesta. Probando como DHT11...");
    dht11.begin();
    delay(2200);
    float t11 = dht11.readTemperature();
    float h11 = dht11.readHumidity();
    if (!isnan(t11) && !isnan(h11)) {
      Serial.printf("  Responde como DHT11: %.1f C  %.1f %%  -> el sensor es DHT11, avisame\n", t11, h11);
    } else {
      Serial.println("  Tampoco responde como DHT11.");
    }
    dht22.begin();
  }
  delay(3000);
}

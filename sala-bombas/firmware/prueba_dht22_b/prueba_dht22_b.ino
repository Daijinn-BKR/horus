/*
 * Prueba B del DHT22 (librería DHTesp) - Omega Eléctrica
 * Requiere instalar: "DHT sensor library for ESPx" (autor: beegee_tokyo)
 * Monitor Serie a 115200.
 */
#include <DHTesp.h>

#define PIN_DHT 4

DHTesp dht;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== PRUEBA B DHT22 (DHTesp) ===");
  dht.setup(PIN_DHT, DHTesp::DHT22);
  delay(2500);
}

void loop() {
  TempAndHumidity v = dht.getTempAndHumidity();
  if (dht.getStatus() == DHTesp::ERROR_NONE) {
    Serial.printf("OK: %.1f C  %.1f %%\n", v.temperature, v.humidity);
  } else {
    Serial.printf("Error: %s\n", dht.getStatusString());
  }
  delay(3000);
}

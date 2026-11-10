// ===== Configuración del módulo — edita estos valores =====
#ifndef CONFIG_H
#define CONFIG_H

// Red WiFi (el ESP32 solo usa 2.4 GHz)
#define WIFI_SSID     "NOMBRE_DE_TU_RED"
#define WIFI_PASS     "CLAVE_DE_TU_RED"

// Proyecto Supabase de Horus (Project Settings → API), sin "/" al final
#define SUPABASE_URL  "https://TU-PROYECTO.supabase.co"
// Clave publicable (publishable / anon). NUNCA la secret / service_role.
#define SUPABASE_KEY  "TU-CLAVE-PUBLICABLE"

// Identificador y clave del módulo: se crean en Horus → Administración → Sala de bombas
#define DEVICE_ID     "sala-bombas-01"
#define DEVICE_KEY    "clave-del-modulo"

// Cada cuánto se envían lecturas (ms)
#define INTERVALO_MS  10000UL

// Pines
#define PIN_DHT       4     // DATA del DHT22 (con pull-up 10k a 3.3V)
#define PIN_PIR       27    // OUT del HC-SR501
// BMP280 por I2C: SDA = GPIO21, SCL = GPIO22

#endif  // CONFIG_H

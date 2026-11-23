// ===== Configuración del módulo =====
// Copia este archivo como config.h (en la misma carpeta) y edita ahí tus valores.
// config.h no se sube al repositorio: lleva la clave del WiFi y la del módulo.
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

// Certificado raíz del servidor de Supabase: el ESP32 solo envía datos si el servidor lo presenta
// (evita que alguien en la red se haga pasar por Supabase). Hoy es "GTS Root R4" de Google Trust
// Services (vence en 2036). Si Supabase cambia de certificado y el ESP32 deja de conectar, revisa
// la cadena con:  openssl s_client -showcerts -connect TU-PROYECTO.supabase.co:443
// y pega aquí el ÚLTIMO certificado de la lista (el raíz), con sus líneas BEGIN/END.
static const char CA_RAIZ[] = R"CERT(
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
)CERT";

// Cada cuánto se envían lecturas (ms)
#define INTERVALO_MS  10000UL

// Pines
#define PIN_DHT       4     // DATA del DHT22 (con pull-up 10k a 3.3V)
#define PIN_PIR       27    // OUT del HC-SR501
// BMP280 por I2C: SDA = GPIO21, SCL = GPIO22

#endif  // CONFIG_H

// Simula el ESP32 de la sala de bombas enviando lecturas a Supabase (sin hardware).
//
// Uso (Node 18+), desde la carpeta sala-bombas:
//   1. Copia .env.example como .env y complétalo
//   2. node simulador.mjs      (envía una lectura cada 10 s; Ctrl+C para parar)
import { readFileSync, existsSync } from "node:fs";

// Lee .env (sin dependencias)
const envPath = new URL("./.env", import.meta.url);
if (existsSync(envPath)) {
  for (const linea of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const { SUPABASE_URL, SUPABASE_KEY, DEVICE_ID = "sala-bombas-01", DEVICE_KEY, INTERVALO_S = "10" } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY || !DEVICE_KEY) {
  console.error("Faltan SUPABASE_URL, SUPABASE_KEY o DEVICE_KEY (ver .env.example).");
  process.exit(1);
}

let t = 0;
function lectura(motivo = "periodico", tiempo = t) {
  const temp = 24 + 4 * Math.sin(tiempo / 30) + Math.random() * 0.4;
  const hum = 60 + 12 * Math.cos(tiempo / 40) + Math.random();
  const a = 17.62, b = 243.12, g = (a * temp) / (b + temp) + Math.log(hum / 100);
  const mov = Math.random() < 0.05;
  return {
    motivo: mov ? "movimiento" : motivo,
    temperatura: +temp.toFixed(1), humedad: +hum.toFixed(1),
    punto_rocio: +((b * g) / (a - g)).toFixed(1),
    presion: +(1012 + Math.sin(tiempo / 60) * 3).toFixed(1),
    temperatura_bmp: +(temp + 0.6).toFixed(1),
    movimiento: mov, pir_calentando: false,
    rssi: -55 - Math.round(Math.random() * 10), uptime_s: tiempo * 10, errores: [],
  };
}

async function enviar(datos) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_lectura`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ p_dispositivo: DEVICE_ID, p_clave: DEVICE_KEY, p_datos: datos }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
}

async function ciclo() {
  t++;
  const d = lectura();
  try { await enviar(d); console.log(new Date().toLocaleTimeString("es-CL"), "OK", JSON.stringify(d)); }
  catch (e) { console.error(new Date().toLocaleTimeString("es-CL"), "Error:", e.message); }
}
console.log(`Simulando ${DEVICE_ID} → ${SUPABASE_URL} cada ${INTERVALO_S} s (Ctrl+C para parar)`);
ciclo();
setInterval(ciclo, Number(INTERVALO_S) * 1000);

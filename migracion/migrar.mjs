// Horus · Migración de las 3 bases antiguas a la base nueva unificada.
//
//   Control Equipos  → equipos, fotos, videos (empresa Omega)  + clientes creados desde el texto "cliente"
//   Inventario       → productos y movimientos (empresa Omega)
//   Lafken Austral   → clientes, personal (operarios) y servicios (empresa Lafken)
//
// Uso (desde la carpeta migracion):
//   npm install
//   copia .env.example como .env y complétalo
//   node migrar.mjs --prueba     ← solo cuenta lo que hay, no escribe nada
//   node migrar.mjs              ← migra (se puede repetir: no duplica)
//
// Las bases antiguas NO se modifican: solo se leen.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// ---------- Configuración ----------
const aqui = (p) => new URL(p, import.meta.url);
if (existsSync(aqui("./.env"))) {
  for (const l of readFileSync(aqui("./.env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const env = process.env;
const PRUEBA = process.argv.includes("--prueba");

// URL y clave de las apps antiguas: se leen de legado/*/config.js (o del .env)
function configVieja(carpeta, prefijo) {
  let url = env[prefijo + "_URL"], key = env[prefijo + "_KEY"];
  const ruta = aqui(`../legado/${carpeta}/config.js`);
  if ((!url || !key) && existsSync(ruta)) {
    const txt = readFileSync(ruta, "utf8");
    url ||= txt.match(/SUPABASE_URL:\s*"([^"]+)"/)?.[1];
    key ||= txt.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)?.[1];
  }
  return { url, key, email: env[prefijo + "_EMAIL"], pass: env[prefijo + "_PASS"] };
}
const ORIGEN = {
  equipos: configVieja("control-equipos", "EQUIPOS"),
  inventario: configVieja("sistema-inventario", "INVENTARIO"),
  lafken: configVieja("lafken-austral", "LAFKEN"),
};
if (!env.NUEVO_URL || !env.NUEVO_SERVICE_KEY) {
  console.error("Falta NUEVO_URL o NUEVO_SERVICE_KEY en migracion/.env");
  process.exit(1);
}
const nuevo = createClient(env.NUEVO_URL, env.NUEVO_SERVICE_KEY, { auth: { persistSession: false } });

async function conectar(nombre, o) {
  if (!o.url || !o.key || !o.email || !o.pass) {
    console.log(`⚠ ${nombre}: faltan datos (URL, clave, correo o contraseña). Se omite.`);
    return null;
  }
  const c = createClient(o.url, o.key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: o.email, password: o.pass });
  if (error) { console.log(`⚠ ${nombre}: no se pudo iniciar sesión (${error.message}). Se omite.`); return null; }
  return c;
}

// Lee una tabla completa en bloques de 1000 (límite de Supabase)
async function leerTodo(c, tabla, orden = "id") {
  const filas = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await c.from(tabla).select("*").order(orden).range(i, i + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...data);
    if (data.length < 1000) return filas;
  }
}
async function escribir(tabla, filas, onConflict) {
  if (PRUEBA || !filas.length) return;
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await nuevo.from(tabla).upsert(filas.slice(i, i + 500), onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}
// Clientes por nombre (se crean si no existen)
const cacheCli = {};
async function clienteId(empresa, nombre) {
  const n = (nombre || "").trim() || "(Sin cliente)";
  const k = empresa + "|" + n.toLowerCase();
  if (cacheCli[k]) return cacheCli[k];
  const { data: ex } = await nuevo.from("clientes").select("id, nombre").eq("empresa_id", empresa).ilike("nombre", n.replace(/[%_\\]/g, "\\$&"));
  if (ex?.length) return (cacheCli[k] = ex[0].id);
  if (PRUEBA) return (cacheCli[k] = "(nuevo)");
  const { data, error } = await nuevo.from("clientes").insert({ empresa_id: empresa, nombre: n }).select("id").single();
  if (error) throw new Error(`clientes: ${error.message}`);
  return (cacheCli[k] = data.id);
}

const inicio = new Date().toISOString();
const resumen = [];

// ---------- 1. Lafken Austral ----------
const lafken = await conectar("Lafken Austral", ORIGEN.lafken);
if (lafken) {
  const [cl, op, sv, so] = await Promise.all([
    leerTodo(lafken, "clientes"), leerTodo(lafken, "operarios"),
    leerTodo(lafken, "servicios"), leerTodo(lafken, "servicio_operarios", "servicio_id"),
  ]);
  await escribir("clientes", cl.map((c) => ({ id: c.id, empresa_id: "lafken", nombre: c.nombre, creado_en: c.created_at })), "id");
  await escribir("personal", op.map((o) => ({ id: o.id, empresa_id: "lafken", nombre: o.nombre, activo: o.activo, creado_en: o.created_at })), "id");
  await escribir("servicios", sv.map((s) => ({
    id: s.id, empresa_id: "lafken", cliente_id: s.cliente_id, fecha: s.fecha, tipos: s.tipos,
    otros_detalle: s.otros_detalle, observaciones: s.observaciones, creado_en: s.created_at,
  })), "id");
  await escribir("servicio_personal", so.map((x) => ({ servicio_id: x.servicio_id, personal_id: x.operario_id })), "servicio_id,personal_id");
  resumen.push(`Lafken: ${cl.length} clientes, ${op.length} operarios → personal, ${sv.length} servicios, ${so.length} asignaciones`);
  const { data: usuarios } = await lafken.from("perfiles").select("email, rol");
  if (usuarios?.length) resumen.push(`  Usuarios de Lafken a recrear en Horus: ${usuarios.map((u) => `${u.email} (${u.rol})`).join(", ")}`);
}

// ---------- 2. Control de Equipos ----------
const equipos = await conectar("Control Equipos", ORIGEN.equipos);
if (equipos) {
  const [eq, fo, vi] = await Promise.all([
    leerTodo(equipos, "equipos"), leerTodo(equipos, "fotos_equipo"), leerTodo(equipos, "videos_equipo"),
  ]);
  const filas = [];
  for (const e of eq) {
    const { cliente, creado_por, ...resto } = e;
    filas.push({ ...resto, empresa_id: "omega", cliente_id: await clienteId("omega", cliente), creado_por: null });
  }
  await escribir("equipos", filas, "id"); // conserva las fechas originales de creación y modificación
  let archivos = 0, fallidos = 0;
  for (const [tabla, lista] of [["fotos_equipo", fo], ["videos_equipo", vi]]) {
    for (const x of lista) {
      const destino = `omega/${x.ruta}`;
      if (!PRUEBA) {
        const { data: blob, error: e1 } = await equipos.storage.from("equipos").download(x.ruta);
        if (e1) { fallidos++; console.log(`  ✗ no se pudo descargar ${x.ruta}: ${e1.message}`); continue; }
        const { error: e2 } = await nuevo.storage.from("equipos").upload(destino, blob, { upsert: true, contentType: blob.type || undefined });
        if (e2) { fallidos++; console.log(`  ✗ no se pudo subir ${destino}: ${e2.message}`); continue; }
        await escribir(tabla, [{ id: x.id, equipo_id: x.equipo_id, ruta: destino, creado_en: x.creado_en, creado_por: null }], "id");
      }
      archivos++;
      if (archivos % 20 === 0) console.log(`  … ${archivos} archivos`);
    }
  }
  const nCli = new Set(eq.map((e) => (e.cliente || "").trim().toLowerCase())).size;
  resumen.push(`Control Equipos: ${eq.length} equipos (${nCli} clientes distintos), ${fo.length} fotos, ${vi.length} videos` +
    (fallidos ? ` — ${fallidos} archivos fallaron` : ""));
}

// ---------- 3. Inventario ----------
const inv = await conectar("Inventario", ORIGEN.inventario);
if (inv) {
  const [pr, mv] = await Promise.all([leerTodo(inv, "productos"), leerTodo(inv, "movimientos")]);
  await escribir("productos", pr.map((p) => ({
    id: p.id, empresa_id: "omega", codigo: p.codigo, nombre: p.nombre, categoria: p.categoria, ubicacion: p.ubicacion,
    unidad: p.unidad, stock: p.stock, stock_minimo: p.stock_minimo, activo: p.activo, creado_en: p.creado_en,
  })), "id");
  // Los movimientos se copian como historial ("migrado"): NO vuelven a mover el stock.
  const { count } = await nuevo.from("movimientos").select("id", { count: "exact", head: true }).eq("migrado", true);
  if (count > 0) resumen.push(`Inventario: ${pr.length} productos actualizados; movimientos ya migrados antes (${count}), no se repiten`);
  else {
    if (!PRUEBA && mv.length) {
      const filas = mv.map((m) => ({ producto_id: m.producto_id, tipo: m.tipo, cantidad: m.cantidad, motivo: m.motivo, usuario: m.usuario, creado_en: m.creado_en, migrado: true }));
      for (let i = 0; i < filas.length; i += 500) {
        const { error } = await nuevo.from("movimientos").insert(filas.slice(i, i + 500));
        if (error) throw new Error(`movimientos: ${error.message}`);
      }
    }
    resumen.push(`Inventario: ${pr.length} productos, ${mv.length} movimientos`);
  }
}

// El historial de cambios no debe llenarse con la migración
if (!PRUEBA) await nuevo.from("auditoria").delete().is("usuario_id", null).gte("fecha", inicio);

console.log("\n" + (PRUEBA ? "PRUEBA (no se escribió nada):" : "Migración terminada:"));
for (const r of resumen) console.log("  " + r);
console.log("\nLos usuarios NO se migran (las contraseñas no se pueden copiar): créalos en Horus → Administración → Usuarios.");

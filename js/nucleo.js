// Horus · núcleo: cliente Supabase, estado de sesión, permisos y utilidades
export const CFG = window.HORUS_CONFIG || {};
export const OPC = CFG.OPCIONES || {};
export const configurado = !!(CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("TU-PROYECTO") &&
  CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("TU-CLAVE"));
export const sb = configurado ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

// Estado global de la sesión
export const H = {
  usuario: null,     // auth.users
  perfil: null,      // fila de perfiles
  empresas: [],      // todas las empresas
  empresa: null,     // empresa activa (objeto)
  cliente: null,     // fila de clientes (solo rol cliente)
};

export const MODULOS = {
  equipos:     { titulo: "Equipos",        ruta: "#/equipos" },
  inventario:  { titulo: "Inventario",     ruta: "#/inventario" },
  servicios:   { titulo: "Servicios",      ruta: "#/servicios" },
  sala_bombas: { titulo: "Sala de bombas", ruta: "#/sala" },
};
export const ROLES = { admin: "Administrador", operario: "Operario", cliente: "Cliente", pendiente: "Sin acceso" };

// ---------- Permisos ----------
export const rol = () => H.perfil?.rol;
export const esAdmin = () => rol() === "admin";
export const esStaff = () => rol() === "admin" || rol() === "operario";
export const esCliente = () => rol() === "cliente";
export const puedeBorrar = () => esAdmin();

// Módulos que ve el usuario en la empresa activa
export function modulosVisibles() {
  const emp = H.empresa?.modulos || [];
  if (esStaff()) return emp.filter((m) => MODULOS[m]);
  if (esCliente()) {
    const cli = H.cliente?.modulos || [];
    return emp.filter((m) => m !== "inventario" && cli.includes(m) && MODULOS[m]);
  }
  return [];
}
export const moduloActivo = (m) => modulosVisibles().includes(m);

// ---------- DOM ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let tAviso;
export function aviso(msg, error = false) {
  const a = $("#aviso");
  a.textContent = msg;
  a.className = "ver" + (error ? " error" : "");
  clearTimeout(tAviso);
  tAviso = setTimeout(() => (a.className = ""), error ? 6000 : 3000);
}
export function msgError(error) {
  if (!error) return "";
  const m = error.message || String(error);
  if (error.code === "23514" || /productos_stock_check/.test(m)) return "Stock insuficiente para esa salida.";
  if (error.code === "23505") return "Ya existe un registro con ese nombre o código.";
  if (error.code === "23503") return "No se puede: hay otros registros que dependen de este.";
  if (error.code === "42501" || /row-level security/i.test(m)) return "No tienes permiso para hacer esto.";
  return m;
}

// Contenido de la vista principal + limpieza al cambiar de pantalla
let limpiezas = [];
export function alSalirDeVista(fn) { limpiezas.push(fn); }
export function limpiarVista() {
  for (const fn of limpiezas.splice(0)) { try { fn(); } catch {} }
}
export function vista(html, ancha = false) {
  const v = $("#vista");
  v.className = ancha ? "ancho" : "";
  v.innerHTML = html;
  window.scrollTo(0, 0);
  return v;
}
export const cargando = () => vista(`<p class="vacio">Cargando…</p>`);
export const sinAcceso = (txt = "No tienes acceso a esta sección.") => vista(`<p class="vacio">${esc(txt)}</p>`);

// ---------- Formatos ----------
export function fecha(iso) {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}
export function fechaHora(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fmtHora = (iso) => new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
export const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 });
export const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const unicos = (l) => [...new Set(l.filter((v) => v != null && String(v).trim() !== ""))];

export function claseEstado(e) {
  const s = String(e || "").toLowerCase();
  if (!s) return "";
  if (s.includes("pend")) return "pendiente";
  if (s.includes("termin") || s.includes("entreg") || s.includes("list")) return "listo";
  return "proceso";
}
export const chipEstado = (e) => (e ? `<span class="chip ${claseEstado(e)}">${esc(e)}</span>` : "");

// ---------- RUT y teléfono (Chile) ----------
// Devuelven el valor normalizado, "" si viene vacío, o null si es inválido.
export function normalizarRut(txt) {
  if (!String(txt || "").trim()) return "";
  const limpio = String(txt).toUpperCase().replace(/[^0-9K]/g, "");
  if (!/^[0-9]{1,8}[0-9K]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1), dv = limpio.slice(-1);
  let suma = 0, factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  if (dv !== esperado) return null;
  return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
}
export function normalizarTelefono(txt) {
  if (!String(txt || "").trim()) return "";
  let d = String(txt).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("56")) d = d.slice(2);
  if (d.length !== 9 || !/^[2-9]/.test(d)) return null;
  return `+56 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
}
// Valida un campo de formulario: marca el error, normaliza el texto y devuelve el valor (o undefined si es inválido)
export function validarCampo(input, normalizar, mensaje) {
  const v = normalizar(input.value);
  if (v === null) {
    input.setAttribute("aria-invalid", "true");
    aviso(mensaje, true);
    input.focus();
    return undefined;
  }
  input.removeAttribute("aria-invalid");
  input.value = v;
  return v || null;
}

// ---------- Enlaces y QR ----------
export const linkEquipo = (id) => location.origin + location.pathname + "#/e/" + encodeURIComponent(id);
export const qrUrl = (texto, size = 300, extra = "") =>
  `https://quickchart.io/qr?size=${size}&margin=1&ecLevel=M${extra}&text=${encodeURIComponent(texto)}`;

// ---------- CSV (abre directo en Excel) ----------
export function descargarCSV(nombre, encabezados, filas) {
  const celda = (v) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : Array.isArray(v) ? v.join(", ") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [encabezados, ...filas].map((f) => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${nombre}-${hoy()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Datos compartidos ----------
// Clientes de la empresa activa (staff). Se guardan en memoria por empresa.
const cacheClientes = {};
export async function clientesEmpresa(forzar = false) {
  const emp = H.empresa?.id;
  if (!emp) return [];
  if (!forzar && cacheClientes[emp]) return cacheClientes[emp];
  const { data, error } = await sb.from("clientes").select("*").eq("empresa_id", emp).order("nombre");
  if (error) { aviso(msgError(error), true); return []; }
  return (cacheClientes[emp] = data);
}
export function olvidarClientes() { for (const k in cacheClientes) delete cacheClientes[k]; }

export function opcionesServicio() {
  const t = OPC.tipos_servicio || {};
  return t[H.empresa?.id] || ["Otros"];
}

// Carga un script externo una sola vez (Chart.js, lector QR)
const scripts = {};
export function cargarScript(src) {
  return (scripts[src] ||= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => { delete scripts[src]; mal(new Error("No se pudo cargar " + src)); };
    document.head.appendChild(s);
  }));
}

// Lector de QR / código de barras con la cámara
let lector = null;
export async function abrirLector(idContenedor, alLeer) {
  await cargarScript("https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js");
  await cerrarLector();
  const l = new window.Html5Qrcode(idContenedor);
  lector = l;
  await l.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, (texto) => {
    if (lector !== l) return;
    cerrarLector().then(() => alLeer(texto));
  }, () => {});
}
export async function cerrarLector() {
  if (!lector) return;
  const l = lector;
  lector = null;
  try { await l.stop(); } catch {}
  try { l.clear(); } catch {}
}

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
  bobinado:    { titulo: "Bobinado",       ruta: "#/bobinado", permiso: "bobinado" },
  precios:     { titulo: "Lista de precios", ruta: "#/precios" },
  ordenes:     { titulo: "Órdenes de trabajo", ruta: "#/ordenes" },
  pendientes:  { titulo: "Pendientes",     ruta: "#/pendientes", soloJefe: true },
  sanitizacion: { titulo: "Sanitización",  ruta: "#/sanitizacion", soloJefe: true },
};
// Módulos que nunca ven los clientes
export const SOLO_PERSONAL = ["inventario", "bobinado", "precios", "ordenes", "pendientes", "sanitizacion"];
// Permisos especiales que el admin da a cada operario
export const PERMISOS = { bobinado: "Bobinado" };
export const ROLES = { admin: "Administrador", jefe: "Jefe eléctrico / Supervisor", operario: "Operario", cliente: "Cliente", pendiente: "Sin acceso" };
// El rol jefe en Lafken es el supervisor
export const nombreRol = (r, empresa) => (r === "jefe" ? (empresa === "lafken" ? "Supervisor" : "Jefe eléctrico") : ROLES[r]);
// Roles que pertenecen a una empresa (necesitan empresa asignada y pueden tener permisos)
export const ROLES_EMPRESA = ["jefe", "operario"];

// ---------- Permisos ----------
export const rol = () => H.perfil?.rol;
export const esAdmin = () => rol() === "admin";
export const esStaff = () => rol() === "admin" || ROLES_EMPRESA.includes(rol());
// Jefe eléctrico (o admin): crea órdenes de trabajo, asigna personal y verifica trabajos. No borra.
export const esJefe = () => rol() === "admin" || rol() === "jefe";
export const esCliente = () => rol() === "cliente";
export const puedeBorrar = () => esAdmin();
export const tienePermiso = (p) => esAdmin() || (ROLES_EMPRESA.includes(rol()) && (H.perfil?.permisos || []).includes(p));

// Módulos que ve el usuario en la empresa activa
export function modulosVisibles() {
  const emp = H.empresa?.modulos || [];
  if (esStaff()) return emp.filter((m) => MODULOS[m] && (!MODULOS[m].permiso || tienePermiso(MODULOS[m].permiso))
    && (!MODULOS[m].soloJefe || esJefe()));
  if (esCliente()) {
    const cli = H.cliente?.modulos || [];
    return emp.filter((m) => !SOLO_PERSONAL.includes(m) && cli.includes(m) && MODULOS[m]);
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
// Error al cargar una lista o ficha. Si falta la tabla, es que no se ejecutó la versión nueva del esquema.
export const msgCarga = (error, tabla) => (new RegExp(tabla).test(error?.message || "")
  ? "Falta ejecutar la versión nueva de supabase/schema.sql en Supabase." : msgError(error));
// Fila de una lista de datos (<dl class="datos">). html ya viene escapado; vacío → "—".
export const dato = (etiqueta, html) =>
  `<dt>${esc(etiqueta)}</dt><dd>${html == null || html === "" ? '<span class="muted">—</span>' : html}</dd>`;

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
  if (s.includes("extern")) return "warn";
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
// Imagen (data URL) del QR, generada en el navegador: el enlace no sale a ningún servicio externo
export async function qrImagen(texto, size = 300, margen = 1) {
  await cargarScript(SCRIPTS.qr);
  const qr = window.qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  const celda = Math.max(2, Math.floor(size / (qr.getModuleCount() + margen * 2)));
  return qr.createDataURL(celda, celda * margen);
}

// ---------- CSV (abre directo en Excel) ----------
export function descargarCSV(nombre, encabezados, filas) {
  const celda = (v) => {
    if (v == null) return "";
    let s = typeof v === "number" ? String(v).replace(".", ",") : Array.isArray(v) ? v.join(", ") : String(v);
    // Un texto que empieza con = + - @ (o tab/retorno) Excel lo ejecuta como fórmula: se antepone '
    if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
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

// ---------- Campo Cliente con búsqueda ----------
// Con cientos de clientes un <select> se pone lento: la lista aparece recién al escribir (ej.: "a" → ACCOR HOTELS).
// Busca en los clientes de la empresa y en RUT Clientes; uno de RUT Clientes se crea como cliente de la empresa al guardar.
export function campoCliente(id, cliente = null) {
  return `<div class="combo"><input id="${id}" type="search" autocomplete="off" placeholder="Escribe el nombre o RUT…"
    value="${esc(cliente?.nombre || "")}" data-id="${esc(cliente?.id || "")}" data-rut=""
    role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-lista">
    <ul class="combo-lista" id="${id}-lista" role="listbox" hidden></ul></div>`;
}
// Texto sin tildes, en minúsculas y sin espacios en los extremos (para buscar: "valvula" encuentra "VÁLVULA")
export const normal = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
// local(): lista propia en la que buscar (ej. solo clientes con sanitización coordinada); si devuelve null, busca en la base
export function activarCampoCliente(input, { local } = {}) {
  const lista = input.nextElementSibling;
  let items = [], activo = -1, t, pedido = 0;
  const cerrar = () => { lista.hidden = true; input.setAttribute("aria-expanded", "false"); activo = -1; };
  const pintar = () => {
    lista.innerHTML = items.length ? items.map((c, i) => `<li role="option" id="${input.id}-op${i}" data-i="${i}"
      aria-selected="${i === activo}"${c.nuevo ? ` class="nuevo-combo">+ Crear cliente nuevo: «${esc(c.nombre)}»`
        : `>${esc(c.nombre)}<small>${esc([c.rut, c.comuna].filter(Boolean).join(" · "))}</small>`}</li>`).join("")
      : `<li class="vacio-combo">Sin resultados</li>`;
    if (activo >= 0) input.setAttribute("aria-activedescendant", `${input.id}-op${activo}`); else input.removeAttribute("aria-activedescendant");
    lista.hidden = false; input.setAttribute("aria-expanded", "true");
  };
  const elegir = (c) => {
    if (c.nuevo) { cerrar(); return clienteNuevo(input, c.nombre); }
    input.value = c.nombre; input.dataset.id = c.id || ""; input.dataset.rut = c.id ? "" : c.rut;
    cerrar(); input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  input.addEventListener("input", () => {
    const habia = input.dataset.id || input.dataset.rut;
    input.dataset.id = ""; input.dataset.rut = "";
    if (habia) input.dispatchEvent(new Event("change", { bubbles: true }));
    const q = input.value.trim(), n = ++pedido;
    clearTimeout(t);
    if (!q) { items = []; cerrar(); return; }
    t = setTimeout(async () => {
      const propia = local?.();
      if (propia) items = propia.filter((c) => normal(`${c.nombre} ${c.rut || ""}`).includes(normal(q))).slice(0, 15);
      else {
        const { data, error } = await sb.rpc("buscar_clientes", { p_empresa: H.empresa.id, p_texto: q });
        if (n !== pedido) return; // llegó la respuesta de una búsqueda anterior
        if (error) return aviso(msgError(error), true);
        items = [...data, { nuevo: true, nombre: q }]; // siempre se puede crear uno nuevo (ej. Instalación)
      }
      activo = -1; pintar();
    }, 200);
  });
  input.addEventListener("keydown", (ev) => {
    if (lista.hidden || !items.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      activo = (activo + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      pintar();
    } else if (ev.key === "Enter" && activo >= 0) { ev.preventDefault(); elegir(items[activo]); }
    else if (ev.key === "Escape") cerrar();
  });
  lista.addEventListener("mousedown", (ev) => { // mousedown: antes de que el campo pierda el foco
    const li = ev.target.closest("[data-i]");
    if (li) { ev.preventDefault(); elegir(items[+li.dataset.i]); }
  });
  input.addEventListener("blur", () => setTimeout(cerrar, 150));
}
// ---------- Personal con un clic ----------
// Casillas para elegir personal, con la foto de perfil al lado (o la inicial si no tiene).
// valor: lo que guarda cada casilla, "id" (servicios, órdenes) o "nombre" (encargados de equipos y bobinado).
export function checksPersonal(personal, marcados, valor = "id") {
  return personal.map((p) => `<label class="persona"><input type="checkbox" value="${esc(p[valor])}"${marcados.includes(p[valor]) ? " checked" : ""}>
    <span class="mini-avatar" data-usuario="${esc(p.usuario_id || "")}" aria-hidden="true">${esc((p.nombre || "?").trim().charAt(0).toUpperCase())}</span>${esc(p.nombre)}</label>`).join("");
}
// Pone las fotos de perfil en las casillas ya pintadas. Es solo adorno: si algo falla, quedan las iniciales.
export async function fotosPersonal(cont) {
  const spans = [...cont.querySelectorAll(".mini-avatar")].filter((s) => s.dataset.usuario);
  if (!spans.length) return;
  const { data } = await sb.rpc("fotos_personal", { p_empresa: H.empresa.id });
  if (!data?.length) return;
  const { data: urls } = await sb.storage.from("avatares").createSignedUrls(data.map((x) => x.foto), 3600);
  const url = Object.fromEntries((urls || []).filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl]));
  const porUsuario = Object.fromEntries(data.map((x) => [x.usuario_id, url[x.foto]]));
  for (const s of spans) if (porUsuario[s.dataset.usuario]) s.innerHTML = `<img src="${esc(porUsuario[s.dataset.usuario])}" alt="">`;
}

// Cliente nuevo: con RUT válido o, si no se consigue, sin RUT (queda URGENTE en la campanita hasta completarlo)
let dlgNuevo = null;
function clienteNuevo(input, nombre) {
  if (!dlgNuevo) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-cliente-nuevo"><form method="dialog" novalidate>
      <h2>Cliente nuevo</h2>
      <label for="cn-nombre" class="req">Nombre</label><input id="cn-nombre" maxlength="120" autocomplete="off">
      <label for="cn-rut" class="req">RUT</label><input id="cn-rut" placeholder="12.345.678-9" autocomplete="off">
      <div class="checks" style="margin-top:10px"><label><input type="checkbox" id="cn-sin-rut">
        No tengo el RUT: guardar solo con el nombre (queda como URGENTE en la campanita para completarlo después)</label></div>
      <div class="pie"><button type="button" id="cn-cancelar">Cancelar</button><button class="primary" type="submit">Crear cliente</button></div>
    </form></dialog>`);
    dlgNuevo = $("#dlg-cliente-nuevo");
    $("#cn-sin-rut").onchange = (ev) => { $("#cn-rut").disabled = ev.target.checked; };
    $("#cn-cancelar").onclick = () => dlgNuevo.close();
    dlgNuevo.querySelector("form").onsubmit = async (ev) => {
      ev.preventDefault();
      const n = $("#cn-nombre").value.trim(), sinRut = $("#cn-sin-rut").checked;
      if (!n) { $("#cn-nombre").focus(); return aviso("Escribe el nombre del cliente.", true); }
      const rut = sinRut ? null : normalizarRut($("#cn-rut").value);
      if (!sinRut && !rut) {
        $("#cn-rut").focus();
        return aviso("El RUT no es válido. Si no lo tienes, marca “No tengo el RUT”.", true);
      }
      const { data, error } = await sb.rpc("crear_cliente", { p_empresa: H.empresa.id, p_nombre: n, p_rut: rut });
      if (error) return aviso(msgError(error), true);
      olvidarClientes();
      const campo = dlgNuevo.campo;
      campo.value = n; campo.dataset.id = data; campo.dataset.rut = "";
      dlgNuevo.close();
      campo.dispatchEvent(new Event("change", { bubbles: true }));
      if (sinRut) document.dispatchEvent(new Event("horus-avisos")); // la campanita lo cuenta
      aviso(sinRut ? "Cliente creado sin RUT: quedó como urgente en la campanita." : "Cliente creado.");
    };
  }
  dlgNuevo.campo = input;
  $("#cn-nombre").value = nombre; $("#cn-rut").value = ""; $("#cn-rut").disabled = false; $("#cn-sin-rut").checked = false;
  dlgNuevo.showModal();
  $("#cn-rut").focus();
}

// Id del cliente elegido (crea el cliente si vino de RUT Clientes). null = campo vacío; undefined = error (ya avisado).
export async function clienteElegido(input) {
  if (input.dataset.id) return input.dataset.id;
  if (input.dataset.rut) {
    const { data, error } = await sb.rpc("cliente_desde_rut", { p_empresa: H.empresa.id, p_rut: input.dataset.rut });
    if (error) { aviso(msgError(error), true); return undefined; }
    olvidarClientes();
    input.dataset.id = data; input.dataset.rut = "";
    return data;
  }
  if (input.value.trim()) { input.focus(); aviso("Elige el cliente de la lista (escribe y toca uno de los resultados).", true); return undefined; }
  return null;
}

export function opcionesServicio() {
  const t = OPC.tipos_servicio || {};
  return t[H.empresa?.id] || ["Otros"];
}

// Librerías externas, con su huella (SRI): si el CDN entregara un archivo alterado, el navegador no lo ejecuta.
// Al cambiar una versión hay que recalcular la huella:
//   curl -sL URL | openssl dgst -sha384 -binary | openssl base64 -A
export const SCRIPTS = {
  lector: { src: "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
    integrity: "sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+" },
  chart: { src: "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
    integrity: "sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD" },
  excel: { src: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
    integrity: "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT" },
  pdf: { src: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    integrity: "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e" },
  pdfWorker: { src: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    integrity: "sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2" },
  qr: { src: "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
    integrity: "sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1" },
};

// Carga un script externo una sola vez
const scripts = {};
export function cargarScript({ src, integrity }) {
  return (scripts[src] ||= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = src; s.integrity = integrity; s.crossOrigin = "anonymous";
    s.onload = ok; s.onerror = () => { delete scripts[src]; mal(new Error("No se pudo cargar " + src)); };
    document.head.appendChild(s);
  }));
}

// Lector de QR / código de barras con la cámara
let lector = null;
export async function abrirLector(idContenedor, alLeer) {
  await cargarScript(SCRIPTS.lector);
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

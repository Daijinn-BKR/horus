// Horus · arranque, sesión, navegación y rutas
import {
  sb, H, configurado, MODULOS, ROLES, $, esc, aviso, modulosVisibles, moduloActivo,
  esAdmin, esStaff, esCliente, rol, limpiarVista, cerrarLector, sinAcceso, olvidarClientes,
} from "./nucleo.js";
import * as equipos from "./equipos.js";
import * as inventario from "./inventario.js";
import * as servicios from "./servicios.js";
import * as sala from "./sala.js";
import * as admin from "./admin.js";
import { renderPublico } from "./publico.js";

// ---------- Rutas ----------
// modulo: requiere ese módulo activo · acceso: "staff" | "admin" (por defecto: cualquier usuario con módulo)
const RUTAS = [
  ...equipos.rutas, ...inventario.rutas, ...servicios.rutas, ...sala.rutas, ...admin.rutas,
];

function mostrarPantalla(cual) {
  for (const id of ["pantalla-login", "pantalla-publica", "pantalla-mensaje", "app"]) $("#" + id).hidden = id !== cual;
}
function mensaje(html) {
  $("#mensaje").innerHTML = html;
  mostrarPantalla("pantalla-mensaje");
}

async function router() {
  limpiarVista();
  await cerrarLector();
  let h = location.hash || "#/";

  // Compatibilidad con los QR antiguos de Control Equipos (#equipo=ID)
  const viejo = h.match(/^#(?:equipo|row)=([^&]+)/);
  if (viejo) { location.replace("#/e/" + viejo[1]); return; }

  // Enlace público de un equipo (QR)
  const pub = h.match(/^#\/e\/([^/?#]+)/);
  if (pub) {
    const id = decodeURIComponent(pub[1]);
    if (!H.usuario) { mostrarPantalla("pantalla-publica"); return renderPublico(id); }
    if (!H.perfil) return;
    // Operario de una empresa sin módulo Equipos (ej. Lafken): ve la ficha limitada, como un visitante
    if (rol() === "operario" && !moduloActivo("equipos")) {
      mostrarPantalla("app"); pintarNav();
      return renderPublico(id, $("#vista"));
    }
    if (esStaff()) {
      // El admin puede escanear un equipo de la otra empresa: se cambia a esa empresa primero
      if (esAdmin()) {
        const { data } = await sb.from("equipos").select("empresa_id").eq("id", id).maybeSingle();
        if (data) cambiarEmpresa(data.empresa_id);
      }
      location.replace("#/equipos/" + encodeURIComponent(id));
      return;
    }
    if (esCliente()) { location.replace("#/equipos/" + encodeURIComponent(id)); return; }
  }

  if (!H.usuario) {
    if (h !== "#/login" && h !== "#/") sessionStorage.setItem("horus.destino", h);
    mostrarPantalla("pantalla-login");
    $("#login-correo").focus();
    return;
  }
  if (!H.perfil) return; // aún cargando el perfil

  mostrarPantalla("app");
  pintarNav();

  if (h === "#/" || h === "#/login" || h === "#") {
    const destino = sessionStorage.getItem("horus.destino");
    sessionStorage.removeItem("horus.destino");
    const primero = modulosVisibles()[0];
    location.replace(destino || (primero ? MODULOS[primero].ruta : esAdmin() ? "#/admin" : "#/sin-modulos"));
    return;
  }
  if (h === "#/sin-modulos") return sinAcceso("No tienes módulos habilitados. Pide al administrador que revise tu cuenta.");

  for (const r of RUTAS) {
    const m = h.match(r.patron);
    if (!m) continue;
    if (r.acceso === "admin" && !esAdmin()) return sinAcceso();
    if (r.acceso === "staff" && !esStaff()) return sinAcceso();
    if (r.acceso === "cliente" && !esCliente()) return sinAcceso();
    if (r.modulo && !moduloActivo(r.modulo)) {
      return sinAcceso(esCliente()
        ? `No tienes habilitado el módulo ${MODULOS[r.modulo].titulo}.`
        : `El módulo ${MODULOS[r.modulo].titulo} no está habilitado para ${H.empresa?.nombre}.`);
    }
    return r.render(...m.slice(1).map(decodeURIComponent));
  }
  sinAcceso("Esta página no existe.");
}
window.addEventListener("hashchange", router);

// ---------- Navegación ----------
function pintarNav() {
  const h = location.hash;
  const links = modulosVisibles().map((m) => [MODULOS[m].ruta, MODULOS[m].titulo]);
  if (esAdmin()) links.push(["#/admin", "Administración"]);
  $("#nav").innerHTML = links.map(([ruta, t]) => {
    const on = h === ruta || h.startsWith(ruta + "/") ||
      (ruta === "#/equipos" && h === "#/escanear");
    return `<a href="${ruta}" class="${on ? "on" : ""}">${esc(t)}</a>`;
  }).join("");

  const sel = $("#sel-empresa");
  sel.hidden = !esAdmin();
  if (esAdmin()) {
    sel.innerHTML = H.empresas.map((e) => `<option value="${e.id}"${e.id === H.empresa?.id ? " selected" : ""}>${esc(e.nombre)}</option>`).join("");
  }
  const p = H.perfil;
  const donde = esAdmin() ? "" : esCliente() ? H.cliente?.nombre : H.empresa?.nombre;
  $("#quien").innerHTML = `${esc(p.nombre || p.email)}<br>${esc(ROLES[p.rol])}${donde ? " · " + esc(donde) : ""}`;
  document.documentElement.style.setProperty("--accent", H.empresa?.color || "");
  if (!H.empresa?.color) document.documentElement.style.removeProperty("--accent");
}

export function cambiarEmpresa(id) {
  const e = H.empresas.find((x) => x.id === id);
  if (!e || e.id === H.empresa?.id) return false;
  H.empresa = e;
  try { localStorage.setItem("horus.empresa", id); } catch {}
  return true;
}
window.horusCambiarEmpresa = cambiarEmpresa;

$("#sel-empresa").addEventListener("change", (ev) => {
  cambiarEmpresa(ev.target.value);
  const primero = modulosVisibles()[0];
  const actual = location.hash.split("/").slice(0, 2).join("/");
  const sigue = Object.values(MODULOS).some((m) => m.ruta === actual) && moduloActivo(Object.keys(MODULOS).find((k) => MODULOS[k].ruta === actual));
  const destino = actual.startsWith("#/admin") ? location.hash : sigue ? actual : primero ? MODULOS[primero].ruta : "#/admin";
  if (location.hash === destino) router(); else location.hash = destino;
});

// ---------- Sesión ----------
async function cargarPerfil() {
  const uid = H.usuario.id;
  const [p, e] = await Promise.all([
    sb.from("perfiles").select("*").eq("id", uid).maybeSingle(),
    sb.from("empresas").select("*").order("nombre"),
  ]);
  if (p.error || e.error) throw p.error || e.error;
  H.perfil = p.data;
  H.empresas = e.data || [];
  H.cliente = null;
  if (!H.perfil || !H.perfil.activo || H.perfil.rol === "pendiente") return false;
  if (H.perfil.rol === "cliente" && H.perfil.cliente_id) {
    const c = await sb.from("clientes").select("*").eq("id", H.perfil.cliente_id).maybeSingle();
    H.cliente = c.data;
  }
  let empId = H.perfil.empresa_id;
  if (esAdmin()) {
    let guardada = null;
    try { guardada = localStorage.getItem("horus.empresa"); } catch {}
    empId = H.empresas.some((x) => x.id === guardada) ? guardada : H.empresas[0]?.id;
  }
  H.empresa = H.empresas.find((x) => x.id === empId) || null;
  return true;
}

let sesionId; // undefined = todavía no se sabe si hay sesión
async function setSesion(sesion) {
  const uid = sesion?.user?.id ?? null;
  if (uid === sesionId) return;
  sesionId = uid;
  H.usuario = sesion?.user ?? null;
  H.perfil = null;
  olvidarClientes();
  if (!H.usuario) { router(); return; }
  try {
    const ok = await cargarPerfil();
    if (!ok) {
      mensaje(`<div class="logo"><img src="icons/emblema.png" alt="">horus</div>
        <h2 style="margin-top:16px">Tu cuenta aún no tiene acceso</h2>
        <p class="muted">${esc(H.usuario.email)}: pide al administrador que te asigne un rol.</p>
        <button class="primary" id="btn-salir-msg">Salir</button>`);
      $("#btn-salir-msg").onclick = () => sb.auth.signOut();
      return;
    }
  } catch (err) {
    mensaje(`<h2>No se pudo cargar tu perfil</h2><p class="muted">${esc(err.message)}</p>
      <button class="primary" onclick="location.reload()">Reintentar</button>`);
    return;
  }
  router();
}

$("#form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("#btn-entrar");
  btn.disabled = true;
  $("#login-error").textContent = "";
  const { error } = await sb.auth.signInWithPassword({
    email: $("#login-correo").value.trim(),
    password: $("#login-clave").value,
  });
  btn.disabled = false;
  if (error) $("#login-error").textContent = "Correo o contraseña incorrectos.";
  else if (location.hash === "#/login") location.hash = "#/";
});
$("#btn-ir-login").addEventListener("click", () => sessionStorage.setItem("horus.destino", location.hash));
$("#btn-salir").addEventListener("click", async () => {
  await cerrarLector();
  await sb.auth.signOut();
  location.hash = "#/";
});

// ---------- Instalar como app (Android, iPhone, Windows) ----------
let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  pedidoInstalar = ev;
  $("#btn-instalar").hidden = false;
});
$("#btn-instalar").addEventListener("click", async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice;
  pedidoInstalar = null;
  $("#btn-instalar").hidden = true;
});
window.addEventListener("appinstalled", () => ($("#btn-instalar").hidden = true));
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- Arranque ----------
if (!configurado) {
  mensaje(`<h2>Falta configurar</h2><p>Copia <code>js/config.example.js</code> como <code>js/config.js</code>
    y pega la URL y la clave <b>publicable</b> de tu proyecto Supabase.</p>`);
} else {
  // INITIAL_SESSION llega siempre al cargar (con o sin sesión)
  sb.auth.onAuthStateChange((_ev, sesion) => setTimeout(() => setSesion(sesion), 0));
}

// ---------- Tema claro / oscuro ----------
const sistemaOscuro = matchMedia("(prefers-color-scheme: dark)");
const temaActual = () => document.documentElement.dataset.theme || (sistemaOscuro.matches ? "dark" : "light");
function pintarBotonesTema() {
  const oscuro = temaActual() === "dark";
  document.querySelectorAll(".btn-tema").forEach((b) => {
    b.textContent = oscuro ? "☀️" : "🌙";
    b.setAttribute("aria-label", oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
  });
}
document.querySelectorAll(".btn-tema").forEach((b) => b.addEventListener("click", () => {
  const nuevo = temaActual() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem("horus.tema", nuevo === "dark" ? "oscuro" : "claro"); } catch (e) { /* sin almacenamiento */ }
  pintarBotonesTema();
  if (location.hash.startsWith("#/sala/")) router(); // los gráficos toman los colores al dibujarse
}));
sistemaOscuro.addEventListener("change", pintarBotonesTema);
pintarBotonesTema();

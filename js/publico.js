// Horus · ficha limitada de un equipo (visitante con el QR y clientes)
import { sb, $, esc, fecha, chipEstado, dato } from "./nucleo.js";

export function fichaLimitadaHTML(f) {
  const fila = (l, v) => dato(l, v ? esc(v) : "");
  return `
    <div class="panel">
      <div class="cabecera">
        <div>
          <div class="muted small">${esc(f.empresa || "")}</div>
          <h1 style="margin:0">${esc(f.tipo_motor || "Equipo")}</h1>
          <div class="muted">ID ${esc(f.id)}</div>
        </div>
        ${chipEstado(f.estado)}
      </div>
    </div>
    <div class="panel">
      <h2>Datos del equipo</h2>
      <dl class="datos">
        ${fila("Cliente", f.cliente)}
        ${fila("Tipo de motor", f.tipo_motor)}
        ${fila("Tipo de voltaje", f.tipo_voltaje)}
        ${fila("Mantenimiento", f.tipo_mantenimiento)}
        ${fila("Estado", f.estado)}
        ${fila("Ingreso", fecha(f.creado_en))}
        ${fila("Última actualización", fecha(f.actualizado_en))}
      </dl>
    </div>`;
}

// cont: #publico (visitante sin sesión) o #vista (usuario con sesión sin acceso a la ficha completa)
export async function renderPublico(id, cont = $("#publico")) {
  const conSesion = cont.id === "vista";
  cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  const { data, error } = await sb.rpc("ficha_publica", { p_id: id });
  if (error) { cont.innerHTML = `<p class="vacio">No se pudo cargar el equipo. Revisa tu conexión.</p>`; return; }
  if (!data) { cont.innerHTML = `<p class="vacio">No existe un equipo con ID ${esc(id)}.</p>`; return; }
  cont.innerHTML = fichaLimitadaHTML(data) + (conSesion ? "" :
    `<p class="muted small" style="text-align:center">¿Eres parte del equipo? <a href="#/login" id="lnk-login">Inicia sesión</a> para ver la ficha completa.</p>`);
  if (!conSesion) $("#lnk-login").onclick = () => sessionStorage.setItem("horus.destino", "#/e/" + encodeURIComponent(id));
}

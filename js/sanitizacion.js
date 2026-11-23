// Horus · Sanitización de estanques (Lafken): Cotizado → Coordinado → Finalizado.
// Solo el supervisor (rol jefe de Lafken) y el admin la ven, la editan y cambian el estado (lo revisa la base de datos).
import {
  sb, H, $, esc, aviso, msgError, msgCarga, dato, vista, cargando, fecha, hoy, descargarCSV,
  clientesEmpresa, esAdmin, esJefe,
} from "./nucleo.js";

const ESTADOS = ["Cotizado", "Coordinado", "Finalizado"];
const SIGUIENTE = { Cotizado: "Coordinado", Coordinado: "Finalizado" };
const CLASE = { Cotizado: "pendiente", Coordinado: "proceso", Finalizado: "listo" };
const chip = (e) => `<span class="chip ${CLASE[e]}">${esc(e)}</span>`;
const ruta = (e) => "#/sanitizacion" + (e === "Cotizado" ? "" : "/" + e.toLowerCase());

export const rutas = [
  { patron: /^#\/sanitizacion$/, modulo: "sanitizacion", acceso: "jefe", render: () => lista("Cotizado") },
  { patron: /^#\/sanitizacion\/(coordinado|finalizado)$/, modulo: "sanitizacion", acceso: "jefe",
    render: (e) => lista(e[0].toUpperCase() + e.slice(1)) },
  { patron: /^#\/sanitizacion\/nuevo$/, modulo: "sanitizacion", acceso: "jefe", render: () => formulario(null) },
  { patron: /^#\/sanitizacion\/([^/]+)\/editar$/, modulo: "sanitizacion", acceso: "jefe", render: (id) => formulario(id) },
  { patron: /^#\/sanitizacion\/([^/]+)$/, modulo: "sanitizacion", acceso: "jefe", render: (id) => ficha(id) },
];

// ---------- Lista (una pestaña por estado) ----------
async function lista(estado) {
  cargando();
  vista(`
    <div class="cabecera"><h1>Sanitización de estanques</h1><a class="btn primary" href="#/sanitizacion/nuevo">+ Nueva cotización</a></div>
    <div class="pestanas">${ESTADOS.map((e) => `<a href="${ruta(e)}" class="${e === estado ? "on" : ""}">${e}</a>`).join("")}</div>
    <div class="filtros"><input id="s-buscar" type="search" placeholder="Buscar por cliente, lugar o personal…" aria-label="Buscar">
      <button id="s-csv">Exportar CSV</button></div>
    <p id="s-conteo" class="muted small"></p>
    <div id="s-lista" class="lista"></div>`);
  const { data, error } = await sb.from("sanitizaciones").select("*, clientes(nombre)")
    .eq("empresa_id", H.empresa.id).eq("estado", estado)
    .order("fecha_programada", { ascending: true, nullsFirst: false }).order("creado_en", { ascending: false });
  if (!$("#s-lista")) return; // el usuario cambió de pantalla mientras cargaba
  if (error) { $("#s-lista").innerHTML = `<p class="vacio">${esc(msgCarga(error, "sanitizaciones"))}</p>`; return; }
  const pintar = () => {
    const q = $("#s-buscar").value.trim().toLowerCase();
    const l = data.filter((s) => !q || [s.clientes?.nombre, s.lugar, s.personal, s.detalle].some((v) => String(v ?? "").toLowerCase().includes(q)));
    $("#s-conteo").textContent = `${l.length} sanitizaci${l.length === 1 ? "ón" : "ones"}`;
    $("#s-lista").innerHTML = l.length ? l.map((s) => `
      <a class="tarjeta" href="#/sanitizacion/${s.id}">
        <div class="t-top"><strong>${esc(s.clientes?.nombre)}</strong><span>${chip(s.estado)}</span></div>
        <div class="muted">${esc(s.lugar)} · ${s.estanques} estanque${s.estanques === 1 ? "" : "s"}</div>
        ${s.estado === "Cotizado" ? "" : `<div class="muted small">${s.fecha_programada ? fecha(s.fecha_programada) : "Sin fecha"}
          · ${esc(s.personal || "Sin personal")}${s.estado === "Coordinado" ? ` · <b>quedan ${s.estanques_pendientes ?? s.estanques}</b>` : ""}</div>`}
      </a>`).join("") : `<p class="vacio">${data.length ? "Sin resultados." : `No hay sanitizaciones en ${estado.toLowerCase()}.`}</p>`;
  };
  $("#s-buscar").oninput = pintar;
  $("#s-csv").onclick = () => descargarCSV("sanitizacion-" + estado.toLowerCase(),
    ["Cliente", "Lugar", "Estanques", "Estado", "Personal", "Fecha", "Quedan", "Detalle"],
    data.map((s) => [s.clientes?.nombre, s.lugar, s.estanques, s.estado, s.personal, s.fecha_programada, s.estanques_pendientes, s.detalle]));
  pintar();
}

// ---------- Ficha ----------
async function ficha(id) {
  cargando();
  const volver = `<a href="#/sanitizacion" class="volver">← Sanitización</a>`;
  const { data: s, error } = await sb.from("sanitizaciones").select("*, clientes(nombre)").eq("id", id).maybeSingle();
  if (error || !s) return vista(`${volver}<p class="vacio">${esc(error ? msgError(error) : "No se encontró la sanitización.")}</p>`);
  const sig = SIGUIENTE[s.estado];
  const editable = s.estado !== "Finalizado" || esJefe();
  const v = vista(`<a href="${ruta(s.estado)}" class="volver">← ${s.estado}</a>
    <div class="panel"><div class="cabecera"><h1 style="margin:0">${esc(s.clientes?.nombre)}</h1><span>${chip(s.estado)}</span></div></div>
    <div class="panel"><h2>Cotización</h2><dl class="datos">
      ${dato("Dónde", esc(s.lugar))}
      ${dato("Cliente", esc(s.clientes?.nombre))}
      ${dato("Estanques", String(s.estanques))}
      ${dato("Detalle", esc(s.detalle || ""))}
    </dl></div>
    ${s.estado === "Cotizado" ? "" : `<div class="panel"><h2>Coordinación</h2><dl class="datos">
      ${dato("Quién va", esc(s.personal || ""))}
      ${dato("Cuándo", s.fecha_programada ? fecha(s.fecha_programada) : "")}
      ${dato("Estanques por hacer", s.estanques_pendientes == null ? "" : `${s.estanques_pendientes} de ${s.estanques}`)}
    </dl></div>`}
    <div class="fila-acciones">
      ${editable ? `<a class="btn${sig && esJefe() ? "" : " primary"}" href="#/sanitizacion/${s.id}/editar">${s.estado === "Coordinado" ? "Actualizar coordinación" : "Editar"}</a>` : ""}
      ${sig && esJefe() ? `<button type="button" class="primary" id="s-avanzar">Pasar a ${sig}</button>` : ""}
      ${esAdmin() ? `<button type="button" class="peligro" id="s-eliminar">Eliminar</button>` : ""}
    </div>
    ${sig && !esJefe() ? `<p class="muted small">Solo el supervisor o un administrador puede pasarla a ${sig.toLowerCase()}.</p>` : ""}
    <p class="muted small">Creada ${fecha(s.creado_en)} · Última modificación ${fecha(s.actualizado_en)}</p>`);

  $("#s-avanzar", v) && ($("#s-avanzar", v).onclick = async () => {
    if (!confirm(`¿Pasar la sanitización de ${s.clientes?.nombre} a “${sig}”?`)) return;
    const { error: e } = await sb.from("sanitizaciones").update({ estado: sig }).eq("id", id);
    if (e) return aviso(msgError(e), true);
    aviso(`Pasó a ${sig}.`);
    location.hash = sig === "Coordinado" ? `#/sanitizacion/${id}/editar` : ruta(sig);
  });
  $("#s-eliminar", v) && ($("#s-eliminar", v).onclick = async () => {
    if (!confirm("¿Eliminar esta sanitización? No se puede deshacer.")) return;
    const { error: e } = await sb.from("sanitizaciones").delete().eq("id", id);
    if (e) return aviso(msgError(e), true);
    aviso("Sanitización eliminada.");
    location.hash = ruta(s.estado);
  });
}

// ---------- Formulario (cotización; y coordinación cuando ya está coordinada) ----------
async function formulario(id) {
  cargando();
  let s = { cliente_id: "", lugar: "", estanques: "", detalle: "", estado: "Cotizado" };
  if (id) {
    const { data, error } = await sb.from("sanitizaciones").select("*").eq("id", id).maybeSingle();
    if (error || !data) return vista(`<a href="#/sanitizacion" class="volver">← Sanitización</a><p class="vacio">No se encontró la sanitización.</p>`);
    s = data;
  }
  const volver = id ? `#/sanitizacion/${id}` : "#/sanitizacion";
  const coord = s.estado !== "Cotizado";
  const clientes = await clientesEmpresa();
  const v = vista(`<a href="${volver}" class="volver">← Volver</a>
    <h1>${id ? (coord ? "Coordinación" : "Editar cotización") : "Nueva cotización"}</h1>
    <form id="form-san" novalidate>
      <div class="panel"><h2>Cotización</h2>
        <label for="f-cliente" class="req">Cliente</label>
        <select id="f-cliente"><option value="">— Selecciona —</option>
          ${clientes.map((c) => `<option value="${c.id}"${c.id === s.cliente_id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>
        <div class="grid2">
          <div><label for="f-lugar" class="req">Dónde</label><input id="f-lugar" value="${esc(s.lugar)}" placeholder="Dirección, centro o planta"></div>
          <div><label for="f-estanques" class="req">Estanques</label><input id="f-estanques" type="number" inputmode="numeric" min="1" step="1" value="${esc(s.estanques)}"></div>
        </div>
        <label for="f-detalle">Detalle</label><textarea id="f-detalle" rows="3">${esc(s.detalle || "")}</textarea>
      </div>
      ${coord ? `<div class="panel"><h2>Coordinación</h2>
        <label for="f-personal" class="req">Quién va</label><input id="f-personal" value="${esc(s.personal || "")}" placeholder="Nombres del personal">
        <div class="grid2">
          <div><label for="f-fecha" class="req">Cuándo</label><input id="f-fecha" type="date" value="${esc(s.fecha_programada || hoy())}"></div>
          <div><label for="f-quedan" class="req">Estanques por hacer</label><input id="f-quedan" type="number" inputmode="numeric" min="0" step="1"
            value="${esc(s.estanques_pendientes ?? s.estanques)}"></div>
        </div>
      </div>` : ""}
      <div class="guardar"><a class="btn" href="${volver}">Cancelar</a>
        <button class="primary" type="submit" id="btn-guardar">${id ? "Guardar cambios" : "Publicar cotización"}</button></div>
    </form>`);

  $("#form-san", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const estanques = Number($("#f-estanques").value);
    const fila = { cliente_id: $("#f-cliente").value, lugar: $("#f-lugar").value.trim(), estanques, detalle: $("#f-detalle").value.trim() || null };
    if (!fila.cliente_id) return aviso("Selecciona un cliente.", true);
    if (!fila.lugar) return aviso("Indica dónde es.", true);
    if (!Number.isInteger(estanques) || estanques < 1) return aviso("Indica cuántos estanques (1 o más).", true);
    if (coord) {
      fila.personal = $("#f-personal").value.trim() || null;
      fila.fecha_programada = $("#f-fecha").value || null;
      fila.estanques_pendientes = Number($("#f-quedan").value);
      if (!fila.personal) return aviso("Indica quién va.", true);
      if (!fila.fecha_programada) return aviso("Indica cuándo se hará.", true);
      if (!Number.isInteger(fila.estanques_pendientes) || fila.estanques_pendientes < 0 || fila.estanques_pendientes > estanques)
        return aviso(`Los estanques por hacer deben estar entre 0 y ${estanques}.`, true);
    }
    const btn = $("#btn-guardar");
    btn.disabled = true;
    const r = id ? await sb.from("sanitizaciones").update(fila).eq("id", id).select("id").single()
      : await sb.from("sanitizaciones").insert({ ...fila, empresa_id: H.empresa.id }).select("id").single();
    if (r.error) { btn.disabled = false; return aviso("Error al guardar: " + msgError(r.error), true); }
    aviso(id ? "Cambios guardados." : "Cotización publicada.");
    location.hash = "#/sanitizacion/" + r.data.id;
  };
}

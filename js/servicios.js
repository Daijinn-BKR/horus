// Horus · Servicios (registro de visitas: desratización, mantención, etc.)
import {
  sb, H, $, $$, esc, aviso, msgError, vista, cargando, fecha, hoy, descargarCSV,
  clientesEmpresa, opcionesServicio, esAdmin, esCliente,
} from "./nucleo.js";

export const rutas = [
  { patron: /^#\/servicios$/, modulo: "servicios", render: () => (esCliente() ? listaCliente() : lista()) },
  { patron: /^#\/servicios\/nuevo$/, modulo: "servicios", acceso: "staff", render: () => formulario(null) },
  { patron: /^#\/servicios\/([^/]+)\/editar$/, modulo: "servicios", acceso: "staff", render: (id) => formulario(id) },
];

const etiquetaTipo = (t, s) => (t === "Otros" && s.otros_detalle ? "Otros: " + s.otros_detalle : t);
const tags = (s) => `<div class="tags">${s.tipos.map((t) => `<span class="chip info">${esc(etiquetaTipo(t, s))}</span>`).join("")}</div>`;

// ---------- Lista (personal) ----------
async function lista() {
  cargando();
  const clientes = await clientesEmpresa();
  const tipos = opcionesServicio();
  vista(`
    <div class="acciones">
      <a class="btn primary" href="#/servicios/nuevo">+ Nuevo servicio</a>
      <button id="btn-csv">Exportar CSV</button>
    </div>
    <div class="panel filtros">
      <div><label for="h-cli">Cliente</label><select id="h-cli"><option value="">Todos</option>
        ${clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></div>
      <div><label for="h-tipo">Servicio</label><select id="h-tipo"><option value="">Todos</option>
        ${tipos.map((t) => `<option>${esc(t)}</option>`).join("")}</select></div>
      <div><label for="h-desde">Desde</label><input type="date" id="h-desde"></div>
      <div><label for="h-hasta">Hasta</label><input type="date" id="h-hasta"></div>
    </div>
    <p class="muted small" id="conteo"></p>
    <div id="lista" class="lista"></div>`);
  let datos = [];
  const cargar = async () => {
    let q = sb.from("servicios").select("*, clientes(nombre), servicio_personal(personal_id, personal(nombre))")
      .eq("empresa_id", H.empresa.id)
      .order("fecha", { ascending: false }).order("creado_en", { ascending: false }).limit(300);
    if ($("#h-cli").value) q = q.eq("cliente_id", $("#h-cli").value);
    if ($("#h-tipo").value) q = q.contains("tipos", [$("#h-tipo").value]);
    if ($("#h-desde").value) q = q.gte("fecha", $("#h-desde").value);
    if ($("#h-hasta").value) q = q.lte("fecha", $("#h-hasta").value);
    const { data, error } = await q;
    if (error) { $("#lista").innerHTML = `<p class="vacio">${esc(msgError(error))}</p>`; return; }
    datos = data;
    $("#conteo").textContent = `${data.length} servicio${data.length === 1 ? "" : "s"}${data.length === 300 ? " (máximo mostrado)" : ""}`;
    $("#lista").innerHTML = data.length ? data.map((s) => `
      <div class="tarjeta">
        <div class="t-top">
          <div><strong>${esc(s.clientes?.nombre)}</strong><div class="muted small">${fecha(s.fecha)}</div></div>
          <div class="acciones" style="margin:0">
            <a class="btn chico" href="#/servicios/${s.id}/editar">Editar</a>
            ${esAdmin() ? `<button class="peligro chico" data-del="${s.id}">Eliminar</button>` : ""}
          </div>
        </div>
        ${tags(s)}
        <div class="muted small">Personal: ${s.servicio_personal.map((x) => esc(x.personal?.nombre)).join(", ") || "—"}</div>
        ${s.observaciones ? `<p style="margin:8px 0 0;white-space:pre-wrap">${esc(s.observaciones)}</p>` : ""}
      </div>`).join("") : `<p class="vacio">Sin servicios registrados.</p>`;
    $$("#lista [data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("¿Eliminar este servicio? No se puede deshacer.")) return;
      const { error: e } = await sb.from("servicios").delete().eq("id", b.dataset.del);
      if (e) aviso(msgError(e), true); else aviso("Servicio eliminado.");
      cargar();
    }));
  };
  ["#h-cli", "#h-tipo", "#h-desde", "#h-hasta"].forEach((s) => ($(s).onchange = cargar));
  $("#btn-csv").onclick = () => descargarCSV("servicios",
    ["Fecha", "Cliente", "Tipos", "Otros", "Personal", "Observaciones"],
    datos.map((s) => [s.fecha, s.clientes?.nombre, s.tipos, s.otros_detalle, s.servicio_personal.map((x) => x.personal?.nombre), s.observaciones]));
  cargar();
}

// ---------- Formulario ----------
async function formulario(id) {
  cargando();
  let s = { cliente_id: "", fecha: hoy(), tipos: [], otros_detalle: "", observaciones: "", ops: [] };
  if (id) {
    const { data, error } = await sb.from("servicios").select("*, servicio_personal(personal_id)").eq("id", id).maybeSingle();
    if (error || !data) { vista(`<a href="#/servicios" class="volver">← Servicios</a><p class="vacio">No se encontró el servicio.</p>`); return; }
    s = { ...data, ops: data.servicio_personal.map((x) => x.personal_id) };
  }
  const [clientes, pers] = await Promise.all([
    clientesEmpresa(),
    sb.from("personal").select("*").eq("empresa_id", H.empresa.id).order("nombre"),
  ]);
  const personal = (pers.data || []).filter((p) => p.activo || s.ops.includes(p.id));
  // En un servicio nuevo, quien lo registra aparece marcado si está vinculado a Personal
  const marcados = id ? s.ops : personal.filter((p) => p.activo && p.usuario_id === H.usuario.id).map((p) => p.id);
  const tipos = [...new Set([...opcionesServicio(), ...s.tipos])];
  const v = vista(`
    <a href="#/servicios" class="volver">← Servicios</a>
    <h1>${id ? "Editar servicio" : "Nuevo servicio"}</h1>
    <form id="form-srv" class="panel" novalidate>
      <label for="f-cliente" class="req">Cliente</label>
      <select id="f-cliente"><option value="">— Selecciona —</option>
        ${clientes.map((c) => `<option value="${c.id}"${c.id === s.cliente_id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>
      ${clientes.length ? "" : `<p class="muted small">No hay clientes. ${esAdmin() ? `<a href="#/admin/clientes">Crear clientes</a>` : "Pide al administrador que los agregue."}</p>`}
      <label for="f-fecha" class="req">Fecha</label><input id="f-fecha" type="date" value="${s.fecha}">
      <label class="req">Personal</label>
      <div class="checks" id="f-ops">
        ${personal.map((o) => `<label><input type="checkbox" value="${o.id}"${marcados.includes(o.id) ? " checked" : ""}>${esc(o.nombre)}</label>`).join("")
          || `<span class="muted small">No hay personal registrado. ${esAdmin() ? `<a href="#/admin/personal">Agregar personal</a>` : "Pide al administrador que lo agregue."}</span>`}
      </div>
      <label class="req">Tipo de servicio</label>
      <div class="checks" id="f-tipos">
        ${tipos.map((t) => `<label><input type="checkbox" value="${esc(t)}"${s.tipos.includes(t) ? " checked" : ""}>${esc(t)}</label>`).join("")}
      </div>
      <div id="otros-box" ${s.tipos.includes("Otros") ? "" : "hidden"}>
        <label for="f-otros" class="req">Especifica "Otros"</label><input id="f-otros" value="${esc(s.otros_detalle)}">
      </div>
      <label for="f-obs">Observaciones</label><textarea id="f-obs">${esc(s.observaciones)}</textarea>
      <div class="guardar"><a class="btn" href="#/servicios">Cancelar</a>
        <button class="primary" type="submit" id="btn-guardar">${id ? "Guardar cambios" : "Guardar servicio"}</button></div>
    </form>`);
  $("#f-tipos", v).onchange = () => { $("#otros-box").hidden = !$$("#f-tipos input:checked").some((i) => i.value === "Otros"); };

  $("#form-srv", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const cliente_id = $("#f-cliente").value, fechaS = $("#f-fecha").value;
    const tiposSel = $$("#f-tipos input:checked").map((i) => i.value);
    const ops = $$("#f-ops input:checked").map((i) => i.value);
    if (!cliente_id) return aviso("Selecciona un cliente.", true);
    if (!fechaS) return aviso("Indica la fecha.", true);
    if (!ops.length) return aviso("Selecciona al menos una persona.", true);
    if (!tiposSel.length) return aviso("Selecciona al menos un tipo de servicio.", true);
    const otros = tiposSel.includes("Otros") ? $("#f-otros").value.trim() : null;
    if (tiposSel.includes("Otros") && !otros) return aviso('Especifica qué es "Otros".', true);
    const fila = { cliente_id, fecha: fechaS, tipos: tiposSel, otros_detalle: otros, observaciones: $("#f-obs").value.trim() || null };
    const btn = $("#btn-guardar");
    btn.disabled = true;
    let sid = id, r;
    if (id) r = await sb.from("servicios").update(fila).eq("id", id);
    else { r = await sb.from("servicios").insert({ ...fila, empresa_id: H.empresa.id }).select("id").single(); sid = r.data?.id; }
    if (r.error) { btn.disabled = false; return aviso("Error al guardar: " + msgError(r.error), true); }
    // Solo se tocan las personas que cambiaron (así el historial de cambios queda limpio)
    const quitar = s.ops.filter((x) => !ops.includes(x)), agregar = ops.filter((x) => !s.ops.includes(x));
    if (quitar.length) {
      const d = await sb.from("servicio_personal").delete().eq("servicio_id", sid).in("personal_id", quitar);
      if (d.error) { btn.disabled = false; return aviso("Error al quitar personal: " + msgError(d.error), true); }
    }
    if (agregar.length) {
      const i = await sb.from("servicio_personal").insert(agregar.map((personal_id) => ({ servicio_id: sid, personal_id })));
      if (i.error) { btn.disabled = false; return aviso("Error al guardar personal: " + msgError(i.error), true); }
    }
    aviso(id ? "Cambios guardados." : "Servicio registrado.");
    location.hash = "#/servicios";
  };
}

// ---------- Vista del cliente ----------
async function listaCliente() {
  cargando();
  const { data, error } = await sb.rpc("mis_servicios");
  if (error) { aviso(msgError(error), true); return; }
  vista(`<h1>Mis servicios</h1><div class="lista">
    ${data.length ? data.map((s) => `
      <div class="tarjeta">
        <strong>${fecha(s.fecha)}</strong>
        ${tags(s)}
        <div class="muted small">Personal: ${esc((s.personal || []).join(", ") || "—")}</div>
        ${s.observaciones ? `<p style="margin:8px 0 0;white-space:pre-wrap">${esc(s.observaciones)}</p>` : ""}
      </div>`).join("") : `<p class="vacio">No tienes servicios registrados.</p>`}
  </div>`);
}

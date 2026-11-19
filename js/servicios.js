// Horus · Servicios (registro de visitas: desratización, mantención, etc.)
import {
  sb, H, $, $$, esc, aviso, msgError, vista, cargando, fecha, hoy, descargarCSV,
  clientesEmpresa, opcionesServicio, esAdmin, esCliente,
} from "./nucleo.js";
import { subirMedios } from "./medios.js";

export const rutas = [
  { patron: /^#\/servicios$/, modulo: "servicios", render: () => (esCliente() ? listaCliente() : lista()) },
  { patron: /^#\/servicios\/nuevo$/, modulo: "servicios", acceso: "staff", render: () => formulario(null) },
  { patron: /^#\/servicios\/([^/]+)\/editar$/, modulo: "servicios", acceso: "staff", render: (id) => formulario(id) },
  { patron: /^#\/servicios\/([^/]+)\/siguiente$/, modulo: "servicios", acceso: "staff", render: (id) => formulario(null, id) },
];

const etiquetaTipo = (t, s) => (t === "Otros" && s.otros_detalle ? "Otros: " + s.otros_detalle : t);
const ORDINAL = ["", "primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "séptima", "octava", "novena", "décima"];
const visitaTxt = (s) => (s.visitas > 1 ? `Visita ${s.visita} de ${s.visitas}` : "");
const serie = (s) => s.serie_id || s.id;
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
    // URLs firmadas de las fotos (bucket privado)
    const fotos = {};
    const rutas = data.filter((s) => s.foto).map((s) => s.foto);
    if (rutas.length) {
      const f = await sb.storage.from("servicios").createSignedUrls(rutas, 3600);
      (f.data || []).forEach((d) => { if (d.signedUrl) fotos[d.path] = d.signedUrl; });
    }
    if (!$("#lista")) return; // cambió de pantalla mientras cargaba
    // Visitas que ya existen, para saber si falta iniciar la siguiente
    const hechas = new Set(data.map((s) => serie(s) + ":" + s.visita));
    $("#conteo").textContent = `${data.length} servicio${data.length === 1 ? "" : "s"}${data.length === 300 ? " (máximo mostrado)" : ""}`;
    $("#lista").innerHTML = data.length ? data.map((s) => `
      <div class="tarjeta">
        <div class="t-top">
          <div><strong>${esc(s.clientes?.nombre)}</strong><div class="muted small">${fecha(s.fecha)}${s.iv ? " · IV " + esc(s.iv) : ""}${s.visitas > 1 ? " · " + visitaTxt(s) : ""}</div></div>
          <div class="acciones" style="margin:0">
            <a class="btn chico" href="#/servicios/${s.id}/editar">Editar</a>
            ${s.visita < s.visitas && !hechas.has(serie(s) + ":" + (s.visita + 1))
              ? `<a class="btn primary chico" href="#/servicios/${s.id}/siguiente">Iniciar ${ORDINAL[s.visita + 1] || "siguiente"} visita</a>` : ""}
            ${esAdmin() ? `<button class="peligro chico" data-del="${s.id}">Eliminar</button>` : ""}
          </div>
        </div>
        ${tags(s)}
        <div class="muted small">Personal: ${s.servicio_personal.map((x) => esc(x.personal?.nombre)).join(", ") || "—"}</div>
        ${s.observaciones ? `<p style="margin:8px 0 0;white-space:pre-wrap">${esc(s.observaciones)}</p>` : ""}
        ${fotos[s.foto] ? `<a href="${esc(fotos[s.foto])}" target="_blank" rel="noopener"><img src="${esc(fotos[s.foto])}" alt="Foto de la visita"
          loading="lazy" style="margin-top:8px;max-width:160px;max-height:120px;border-radius:8px;object-fit:cover"></a>` : ""}
      </div>`).join("") : `<p class="vacio">Sin servicios registrados.</p>`;
    $$("#lista [data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("¿Eliminar este servicio? No se puede deshacer.")) return;
      const foto = datos.find((x) => x.id === b.dataset.del)?.foto;
      if (foto) await sb.storage.from("servicios").remove([foto]);
      const { error: e } = await sb.from("servicios").delete().eq("id", b.dataset.del);
      if (e) aviso(msgError(e), true); else aviso("Servicio eliminado.");
      cargar();
    }));
  };
  ["#h-cli", "#h-tipo", "#h-desde", "#h-hasta"].forEach((s) => ($(s).onchange = cargar));
  $("#btn-csv").onclick = () => descargarCSV("servicios",
    ["Fecha", "IV", "Visita", "Cliente", "Tipos", "Otros", "Personal", "Observaciones"],
    datos.map((s) => [s.fecha, s.iv, `${s.visita} de ${s.visitas}`, s.clientes?.nombre, s.tipos, s.otros_detalle, s.servicio_personal.map((x) => x.personal?.nombre), s.observaciones]));
  cargar();
}

// ---------- Formulario ----------
// id: editar ese servicio · desde: nueva visita que sigue a ese servicio
async function formulario(id, desde = null) {
  cargando();
  let s = { cliente_id: "", fecha: hoy(), tipos: [], otros_detalle: "", observaciones: "", ops: [], iv: "", visita: 1, visitas: 1, serie_id: null, foto: null };
  if (id || desde) {
    const { data, error } = await sb.from("servicios").select("*, servicio_personal(personal_id)").eq("id", id || desde).maybeSingle();
    if (error || !data) { vista(`<a href="#/servicios" class="volver">← Servicios</a><p class="vacio">No se encontró el servicio.</p>`); return; }
    s = { ...data, ops: data.servicio_personal.map((x) => x.personal_id) };
    // Siguiente visita: mismo cliente, servicio y personal; IV, fecha, foto y observaciones nuevos
    if (desde) s = { ...s, id: undefined, fecha: hoy(), iv: "", observaciones: "", foto: null, visita: data.visita + 1, serie_id: serie(data) };
  }
  const [clientes, pers] = await Promise.all([
    clientesEmpresa(),
    sb.from("personal").select("*").eq("empresa_id", H.empresa.id).order("nombre"),
  ]);
  const personal = (pers.data || []).filter((p) => p.activo || s.ops.includes(p.id));
  // En un servicio nuevo, quien lo registra aparece marcado si está vinculado a Personal
  const marcados = id || desde ? s.ops : personal.filter((p) => p.activo && p.usuario_id === H.usuario.id).map((p) => p.id);
  const tipos = [...new Set([...opcionesServicio(), ...s.tipos])];
  const v = vista(`
    <a href="#/servicios" class="volver">← Servicios</a>
    <h1>${id ? "Editar servicio" : desde ? `${ORDINAL[s.visita] ? ORDINAL[s.visita][0].toUpperCase() + ORDINAL[s.visita].slice(1) : "Siguiente"} visita` : "Nuevo servicio"}</h1>
    <form id="form-srv" class="panel" novalidate>
      <label for="f-cliente" class="req">Cliente</label>
      <select id="f-cliente"><option value="">— Selecciona —</option>
        ${clientes.map((c) => `<option value="${c.id}"${c.id === s.cliente_id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>
      ${clientes.length ? "" : `<p class="muted small">No hay clientes. ${esAdmin() ? `<a href="#/admin/clientes">Crear clientes</a>` : "Pide al administrador que los agregue."}</p>`}
      <div class="grid2">
        <div><label for="f-fecha" class="req">Fecha</label><input id="f-fecha" type="date" value="${s.fecha}"></div>
        <div><label for="f-iv" class="req">IV (informe de visita)</label><input id="f-iv" inputmode="numeric" pattern="[0-9]{4,}" placeholder="Mínimo 4 números" value="${esc(s.iv || "")}"></div>
        <div><label for="f-visitas" class="req">Número de visitas</label><input id="f-visitas" type="number" inputmode="numeric" min="${s.visita}" step="1" value="${s.visitas}"></div>
        <div><label>Esta visita</label><p style="margin:8px 0">${s.visita}${s.visita > 1 ? ` <span class="muted small">(${ORDINAL[s.visita] || "siguiente"} visita)</span>` : ""}</p></div>
      </div>
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
      <label for="f-foto">Foto${s.foto ? " (ya tiene una; elige otra para reemplazarla)" : ""}</label>
      <input id="f-foto" type="file" accept="image/*">
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
    const iv = $("#f-iv").value.trim(), visitas = Number($("#f-visitas").value);
    if (!/^[0-9]{4,}$/.test(iv)) { $("#f-iv").focus(); return aviso("El IV debe tener al menos 4 números (solo números).", true); }
    if (!Number.isInteger(visitas) || visitas < s.visita) return aviso(`El número de visitas debe ser ${s.visita} o más.`, true);
    const fila = { cliente_id, fecha: fechaS, tipos: tiposSel, otros_detalle: otros, observaciones: $("#f-obs").value.trim() || null, iv, visitas };
    if (!id) Object.assign(fila, { visita: s.visita, serie_id: s.serie_id });
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
    const foto = $("#f-foto").files[0];
    if (foto) {
      const ok = await subirMedios({ bucket: "servicios", carpeta: H.empresa.id, files: [foto], tipo: "foto",
        registrar: (ruta) => sb.from("servicios").update({ foto: ruta }).eq("id", sid) });
      if (!ok) { btn.disabled = false; location.hash = `#/servicios/${sid}/editar`; return; } // el servicio quedó guardado; falta la foto
      // shortcut: la foto anterior solo se borra si la subió este usuario o es admin; si no, queda sin uso en el bucket
      if (s.foto) await sb.storage.from("servicios").remove([s.foto]);
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

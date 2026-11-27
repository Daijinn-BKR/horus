// Horus · Servicios (registro de visitas: desratización, mantención, etc.)
import {
  sb, H, $, $$, esc, aviso, msgError, vista, cargando, fecha, hoy, descargarCSV,
  clientesEmpresa, nombreCSV, checksPersonal, fotosPersonal, campoCliente, activarCampoCliente, clienteElegido, opcionesServicio, esAdmin, esCliente,
} from "./nucleo.js";
import { subirMedios } from "./medios.js";
import { olvidarAvisos } from "./calendario.js";

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
      <a class="btn" href="#/servicios/calendario">Calendario</a>
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
    const rutas = data.flatMap((s) => [s.foto_obs, s.foto].filter(Boolean));
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
          <div><strong>${esc(s.clientes?.nombre)}</strong><div class="muted small">${fecha(s.fecha)}${s.iv ? " · IV " + esc(s.iv) : ""}${s.csi ? " · CSI " + esc(s.csi) : ""}${s.visitas > 1 ? " · " + visitaTxt(s) : ""}</div></div>
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
        ${[[s.foto_obs, "Foto de las observaciones del IV"], [s.foto, "Foto del IV"]].filter(([r]) => fotos[r]).map(([r, alt]) =>
          `<a href="${esc(fotos[r])}" target="_blank" rel="noopener"><img src="${esc(fotos[r])}" alt="${alt}" title="${alt}"
          loading="lazy" style="margin:8px 8px 0 0;max-width:160px;max-height:120px;border-radius:8px;object-fit:cover"></a>`).join("")}
      </div>`).join("") : `<p class="vacio">Sin servicios registrados.</p>`;
    $$("#lista [data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("¿Eliminar este servicio? No se puede deshacer.")) return;
      const x = datos.find((y) => y.id === b.dataset.del), rutas = [x?.foto, x?.foto_obs].filter(Boolean);
      const { error: e } = await sb.from("servicios").delete().eq("id", b.dataset.del);
      if (e) aviso(msgError(e), true);
      else {
        if (rutas.length) await sb.storage.from("servicios").remove(rutas); // las fotos solo se borran si el servicio ya no existe
        aviso("Servicio eliminado.");
      }
      cargar();
    }));
  };
  ["#h-cli", "#h-tipo", "#h-desde", "#h-hasta"].forEach((s) => ($(s).onchange = cargar));
  $("#btn-csv").onclick = () => descargarCSV(nombreCSV("servicios", "h"),
    ["Fecha", "IV", "CSI", "Visita", "Cliente", "Tipos", "Otros", "Personal", "Observaciones"],
    datos.map((s) => [s.fecha, s.iv, s.csi, `${s.visita} de ${s.visitas}`, s.clientes?.nombre, s.tipos, s.otros_detalle, s.servicio_personal.map((x) => x.personal?.nombre), s.observaciones]));
  cargar();
}

// ---------- Formulario ----------
// id: editar ese servicio · desde: nueva visita que sigue a ese servicio
async function formulario(id, desde = null) {
  cargando();
  let s = { cliente_id: "", fecha: hoy(), tipos: [], otros_detalle: "", observaciones: "", ops: [], iv: "", visita: 1, visitas: 1, serie_id: null, foto: null, foto_obs: null };
  if (id || desde) {
    const { data, error } = await sb.from("servicios").select("*, servicio_personal(personal_id)").eq("id", id || desde).maybeSingle();
    if (error || !data) { vista(`<a href="#/servicios" class="volver">← Servicios</a><p class="vacio">No se encontró el servicio.</p>`); return; }
    s = { ...data, ops: data.servicio_personal.map((x) => x.personal_id) };
    // Siguiente visita: mismo cliente, servicio y personal; IV, fecha y fotos nuevos
    if (desde) s = { ...s, id: undefined, fecha: hoy(), iv: "", csi: "", observaciones: "", foto: null, foto_obs: null, estanques: null, visita: data.visita + 1, serie_id: serie(data) };
  }
  const [clientes, pers, coord] = await Promise.all([
    clientesEmpresa(),
    sb.from("personal").select("*").eq("empresa_id", H.empresa.id).order("nombre"),
    opcionesServicio().includes("SEAP") ? sb.rpc("sanitizaciones_coordinadas", { p_empresa: H.empresa.id }) : { data: [] },
  ]);
  // SEAP: solo clientes con una sanitización coordinada; los estanques se descuentan de la sanitización elegida.
  // Al editar se mantiene la sanitización que ya tenía, aunque ya esté finalizada.
  const sans = coord.data || [];
  if (s.sanitizacion_id && !sans.some((x) => x.id === s.sanitizacion_id)) {
    sans.push({ id: s.sanitizacion_id, cliente_id: s.cliente_id, lugar: "Sanitización finalizada", pendientes: 0 });
  }
  const porHacer = (x) => x.pendientes + (x.id === s.sanitizacion_id ? s.estanques || 0 : 0);
  const coordinados = new Set(sans.map((x) => x.cliente_id));
  const seapMarcado = () => $$("#f-tipos input:checked").some((i) => i.value === "SEAP");
  const personal = (pers.data || []).filter((p) => p.activo || s.ops.includes(p.id));
  // En un servicio nuevo, quien lo registra aparece marcado si está vinculado a Personal
  const marcados = id || desde ? s.ops : personal.filter((p) => p.activo && p.usuario_id === H.usuario.id).map((p) => p.id);
  const tipos = [...new Set([...opcionesServicio(), ...s.tipos])];
  const campoFoto = (k, titulo, nota) => `
      <label>${titulo} <span class="muted small">(${nota})</span>${s[k] ? ` <span class="muted small">· ya tiene una; elige otra para reemplazarla</span>` : ""}</label>
      <div class="acciones" style="margin:0;align-items:center">
        <label class="btn subir">Tomar foto<input type="file" data-foto="${k}" accept="image/*" capture="environment"></label>
        <label class="btn subir">Elegir de la galería<input type="file" data-foto="${k}" accept="image/*"></label>
        <span class="muted small" id="nombre-${k}"></span></div>`;
  const v = vista(`
    <a href="#/servicios" class="volver">← Servicios</a>
    <h1>${id ? "Editar servicio" : desde ? `${ORDINAL[s.visita] ? ORDINAL[s.visita][0].toUpperCase() + ORDINAL[s.visita].slice(1) : "Siguiente"} visita` : "Nuevo servicio"}</h1>
    <form id="form-srv" class="panel" novalidate>
      <label for="f-cliente" class="req">Cliente</label>
      ${campoCliente("f-cliente", clientes.find((c) => c.id === s.cliente_id))}
      <div id="seap-box" ${s.tipos.includes("SEAP") ? "" : "hidden"}>
        <p class="muted small">SEAP: solo aparecen los clientes con una sanitización coordinada. Los estanques se descuentan de los pendientes.</p>
        <div class="grid2">
          <div><label for="f-san" class="req">Sanitización</label><select id="f-san"></select></div>
          <div><label for="f-estanques" class="req">Estanques sanitizados</label>
            <input id="f-estanques" type="number" inputmode="numeric" min="1" step="1" value="${s.estanques || ""}"></div>
        </div>
      </div>
      <div class="grid2">
        <div><label for="f-fecha" class="req">Fecha</label><input id="f-fecha" type="date" value="${s.fecha}"></div>
        <div><label for="f-iv" class="req">IV (informe de visita)</label><input id="f-iv" inputmode="numeric" pattern="[0-9]{4,}" placeholder="Mínimo 4 números" value="${esc(s.iv || "")}"></div>
        <div><label for="f-visitas" class="req">Número de visitas</label><input id="f-visitas" type="number" inputmode="numeric" min="${s.visita}" step="1" value="${s.visitas}"></div>
        <div id="csi-box" ${s.visita === s.visitas ? "" : "hidden"}><label for="f-csi" class="req">CSI (última visita)</label>
          <input id="f-csi" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="5 números" value="${esc(s.csi || "")}"></div>
        <div><label>Esta visita</label><p style="margin:8px 0">${s.visita}${s.visita > 1 ? ` <span class="muted small">(${ORDINAL[s.visita] || "siguiente"} visita)</span>` : ""}</p></div>
      </div>
      <label class="req">Personal</label>
      <div class="checks" id="f-ops">
        ${checksPersonal(personal, marcados)
          || `<span class="muted small">No hay personal registrado. ${esAdmin() ? `<a href="#/admin/personal">Agregar personal</a>` : "Pide al administrador que lo agregue."}</span>`}
      </div>
      <label class="req">Tipo de servicio</label>
      <div class="checks" id="f-tipos">
        ${tipos.map((t) => `<label><input type="checkbox" value="${esc(t)}"${s.tipos.includes(t) ? " checked" : ""}>${esc(t)}</label>`).join("")}
      </div>
      <div id="otros-box" ${s.tipos.includes("Otros") ? "" : "hidden"}>
        <label for="f-otros" class="req">Especifica "Otros"</label><input id="f-otros" value="${esc(s.otros_detalle)}">
      </div>
      ${campoFoto("foto_obs", "Foto observaciones", "una foto de las observaciones del IV")}
      ${campoFoto("foto", "Foto", "el IV completo y otras cosas, opcional")}
      <div class="guardar"><a class="btn" href="#/servicios">Cancelar</a>
        <button class="primary" type="submit" id="btn-guardar">${id ? "Guardar cambios" : "Guardar servicio"}</button></div>
    </form>`);
  const pintarSan = () => {
    const l = sans.filter((x) => x.cliente_id === $("#f-cliente").dataset.id), sel = $("#f-san").value || s.sanitizacion_id;
    $("#f-san").innerHTML = l.length
      ? l.map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.lugar)} · quedan ${porHacer(x)} estanque${porHacer(x) === 1 ? "" : "s"}</option>`).join("")
      : `<option value="">— Elige primero el cliente —</option>`;
  };
  pintarSan();
  // Con SEAP marcado, la búsqueda es solo entre los clientes con una sanitización coordinada
  fotosPersonal($("#f-ops", v));
  activarCampoCliente($("#f-cliente", v), { local: () => (seapMarcado() ? clientes.filter((c) => coordinados.has(c.id)) : null) });
  $("#f-cliente", v).onchange = pintarSan;
  // CSI: se entrega con la última visita (visita N de N)
  $("#f-visitas", v).oninput = () => { $("#csi-box").hidden = Number($("#f-visitas").value) !== s.visita; };
  // Cada foto: de la cámara o de la galería (la última que se elija)
  const elegidas = {};
  $$("[data-foto]", v).forEach((inp) => (inp.onchange = () => {
    const k = inp.dataset.foto;
    elegidas[k] = inp.files[0] || elegidas[k];
    inp.value = "";
    $("#nombre-" + k).textContent = elegidas[k] ? "✓ " + elegidas[k].name : "";
  }));
  $("#f-tipos", v).onchange = () => {
    const marcados = $$("#f-tipos input:checked").map((i) => i.value), seap = marcados.includes("SEAP");
    $("#otros-box").hidden = !marcados.includes("Otros");
    $("#seap-box").hidden = !seap;
    const fc = $("#f-cliente");
    if (seap && (fc.dataset.rut || (fc.dataset.id && !coordinados.has(fc.dataset.id)))) { // sin nada coordinado: queda sin elegir
      fc.value = ""; fc.dataset.id = ""; fc.dataset.rut = "";
    }
    pintarSan();
  };

  $("#form-srv", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const cliente_id = await clienteElegido($("#f-cliente")), fechaS = $("#f-fecha").value;
    if (cliente_id === undefined) return;
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
    const ultima = visitas === s.visita, csi = ultima ? $("#f-csi").value.trim() : null;
    if (ultima && !/^[0-9]{5}$/.test(csi)) { $("#f-csi").focus(); return aviso("En la última visita va el CSI: 5 números.", true); }
    const seap = tiposSel.includes("SEAP");
    const sanitizacion_id = seap ? $("#f-san").value : null, estanques = seap ? Number($("#f-estanques").value) : null;
    if (seap && !sanitizacion_id) return aviso("SEAP: el cliente no tiene una sanitización coordinada.", true);
    if (seap && !(Number.isInteger(estanques) && estanques >= 1)) { $("#f-estanques").focus(); return aviso("Indica cuántos estanques se sanitizaron.", true); }
    const fila = { cliente_id, fecha: fechaS, tipos: tiposSel, otros_detalle: otros, observaciones: s.observaciones || null, iv, visitas,
      sanitizacion_id, estanques, csi };
    if (!id) Object.assign(fila, { empresa_id: H.empresa.id, visita: s.visita, serie_id: s.serie_id });
    const btn = $("#btn-guardar");
    btn.disabled = true;
    // El servicio y su personal se guardan juntos: si algo falla, no queda nada a medias
    const r = await sb.rpc("srv_guardar", { p_id: id || null, p_datos: fila, p_personal: ops });
    if (r.error) { btn.disabled = false; return aviso("Error al guardar: " + msgError(r.error), true); }
    const sid = r.data;
    olvidarAvisos(); // la próxima visita del calendario puede haber cambiado
    for (const k of ["foto_obs", "foto"]) {
      if (!elegidas[k]) continue;
      const ok = await subirMedios({ bucket: "servicios", carpeta: H.empresa.id, files: [elegidas[k]], tipo: "foto",
        registrar: (ruta) => sb.from("servicios").update({ [k]: ruta }).eq("id", sid) });
      if (!ok) { btn.disabled = false; location.hash = `#/servicios/${sid}/editar`; return; } // el servicio quedó guardado; falta la foto
      // shortcut: la foto anterior solo se borra si la subió este usuario o es admin; si no, queda sin uso en el bucket
      if (s[k]) await sb.storage.from("servicios").remove([s[k]]);
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

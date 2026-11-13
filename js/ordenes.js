// Horus · Órdenes de trabajo (Omega): el jefe eléctrico crea la orden y asigna personal;
// el personal asignado la inicia y la termina con un informe (y fotos/videos); el jefe (o un admin) la verifica.
import {
  sb, H, OPC, $, $$, esc, aviso, msgError, msgCarga, dato, vista, cargando, fecha, fmtHora, hoy, descargarCSV,
  clientesEmpresa, esAdmin, esJefe, alSalirDeVista,
} from "./nucleo.js";
import { subirMedios, pintarMedios, borrarMedio } from "./medios.js";

const BUCKET = "ordenes"; // fotos y videos: <empresa>/<orden>/<archivo>

export const rutas = [
  { patron: /^#\/ordenes$/, modulo: "ordenes", acceso: "staff", render: () => lista() },
  { patron: /^#\/ordenes\/nueva$/, modulo: "ordenes", acceso: "jefe", render: () => formulario(null) },
  { patron: /^#\/ordenes\/([^/]+)\/editar$/, modulo: "ordenes", acceso: "jefe", render: (id) => formulario(id) },
  { patron: /^#\/ordenes\/([^/]+)$/, modulo: "ordenes", acceso: "staff", render: (id) => ficha(id) },
];

const TIPOS_BASE = ["Instalación eléctrica", "Mantención de tablero", "Reparación de falla", "Empalme / medidor",
  "Iluminación", "Motores y bombas", "Puesta a tierra", "Inspección / certificación", "Otros"];
const tiposOrden = () => (OPC.tipos_orden?.length ? OPC.tipos_orden : TIPOS_BASE);
const PRIORIDADES = ["Baja", "Normal", "Alta", "Urgente"];
const ESTADOS = ["Asignada", "En curso", "Terminada", "Verificada"];
const CLASE_ESTADO = { Asignada: "pendiente", "En curso": "proceso", Terminada: "warn", Verificada: "listo" };
const TXT_ESTADO = { Terminada: "Terminada · por verificar" };
const chipOT = (e) => `<span class="chip ${CLASE_ESTADO[e] || ""}">${esc(TXT_ESTADO[e] || e)}</span>`;
const chipPrioridad = (p) => (p === "Urgente" ? `<span class="chip mal">Urgente</span>` : p === "Alta" ? `<span class="chip warn">Alta</span>` : "");
const num = (o) => "OT-" + String(o.numero).padStart(4, "0");
const nombres = (o) => (o.orden_personal || []).map((x) => x.personal?.nombre).filter(Boolean);
const soyAsignado = (o) => (o.orden_personal || []).some((x) => x.personal?.usuario_id === H.usuario.id);
const atrasada = (o) => o.fecha_programada && o.fecha_programada < hoy() && ["Asignada", "En curso"].includes(o.estado);

const SELECT = "*, clientes(nombre), orden_personal(personal_id, personal(nombre, usuario_id))";

// ---------- Lista ----------
async function lista() {
  cargando();
  // Operario: por defecto ve sus órdenes. Jefe: las que esperan verificación.
  const filtroInicial = esJefe() ? "Terminada" : "mias";
  vista(`
    <div class="cabecera"><h1>Órdenes de trabajo</h1>
      ${esJefe() ? `<a class="btn primary" href="#/ordenes/nueva">+ Nueva orden</a>` : ""}</div>
    <div class="filtros">
      <input id="o-buscar" type="search" placeholder="Buscar por N°, título, cliente o lugar…" aria-label="Buscar">
      <select id="o-estado" aria-label="Mostrar">
        <option value="abiertas">Pendientes (sin verificar)</option>
        <option value="mias">Mis órdenes</option>
        ${ESTADOS.map((e) => `<option value="${e}">${esc(TXT_ESTADO[e] || e)}</option>`).join("")}
        <option value="">Todas</option>
      </select>
      <button id="o-csv">Exportar CSV</button>
    </div>
    <p id="o-conteo" class="muted small"></p>
    <div id="o-lista" class="lista"></div>`);
  $("#o-estado").value = filtroInicial;
  let datos = [];
  const cargar = async () => {
    const { data, error } = await sb.from("ordenes_trabajo").select(SELECT)
      .eq("empresa_id", H.empresa.id).order("creado_en", { ascending: false }).limit(500);
    if (!$("#o-lista")) return; // el usuario cambió de pantalla mientras cargaba
    if (error) {
      $("#o-lista").innerHTML = `<p class="vacio">${esc(msgCarga(error, "ordenes_trabajo"))}</p>`;
      return;
    }
    datos = data;
    pintar();
  };
  const pintar = () => {
    const f = $("#o-estado").value, q = $("#o-buscar").value.trim().toLowerCase();
    const l = datos.filter((o) =>
      (f === "" || (f === "abiertas" ? o.estado !== "Verificada" : f === "mias" ? soyAsignado(o) && o.estado !== "Verificada" : o.estado === f)) &&
      (!q || [num(o), o.titulo, o.tipo, o.clientes?.nombre, o.ubicacion, ...nombres(o)].some((v) => String(v ?? "").toLowerCase().includes(q))));
    const porVerificar = datos.filter((o) => o.estado === "Terminada").length;
    $("#o-conteo").textContent = `${l.length} orden${l.length === 1 ? "" : "es"}` +
      (esJefe() && porVerificar ? ` · ${porVerificar} esperando verificación` : "");
    $("#o-lista").innerHTML = l.length ? l.map((o) => `
      <a class="tarjeta" href="#/ordenes/${o.id}">
        <div class="t-top"><strong>${esc(num(o))} · ${esc(o.titulo)}</strong><span>${chipPrioridad(o.prioridad)} ${chipOT(o.estado)}</span></div>
        <div class="muted">${esc(o.tipo)}${o.clientes?.nombre ? " · " + esc(o.clientes.nombre) : ""}${o.ubicacion ? " · " + esc(o.ubicacion) : ""}</div>
        <div class="muted small">${nombres(o).length ? "A cargo: " + esc(nombres(o).join(", ")) : "Sin personal asignado"}
          ${o.fecha_programada ? ` · Programada ${fecha(o.fecha_programada)}` : ""}
          ${atrasada(o) ? ` <span class="chip mal">Atrasada</span>` : ""}
          ${o.devoluciones && o.estado === "En curso" ? ` <span class="chip warn">Devuelta</span>` : ""}</div>
      </a>`).join("")
      : `<p class="vacio">${datos.length ? "No hay órdenes con este filtro." : esJefe() ? "Todavía no hay órdenes. Toca “+ Nueva orden”." : "Todavía no hay órdenes."}</p>`;
  };
  $("#o-estado").onchange = pintar;
  $("#o-buscar").oninput = pintar;
  $("#o-csv").onclick = () => descargarCSV("ordenes-trabajo",
    ["N°", "Título", "Tipo", "Prioridad", "Cliente", "Ubicación", "Programada", "Estado", "A cargo", "Informe", "Materiales", "Terminada", "Verificada", "Obs. verificación", "Devoluciones", "Creada"],
    datos.map((o) => [num(o), o.titulo, o.tipo, o.prioridad, o.clientes?.nombre, o.ubicacion, o.fecha_programada, o.estado,
      nombres(o), o.informe, o.materiales, o.terminado_en && fmtHora(o.terminado_en), o.verificado_en && fmtHora(o.verificado_en),
      o.obs_verificacion, o.devoluciones, fmtHora(o.creado_en)]));
  await cargar();

  let t;
  const canal = sb.channel("ordenes-lista")
    .on("postgres_changes", { event: "*", schema: "public", table: "ordenes_trabajo" }, () => { clearTimeout(t); t = setTimeout(cargar, 300); })
    .subscribe();
  alSalirDeVista(() => { clearTimeout(t); sb.removeChannel(canal); });
}

// ---------- Ficha ----------
async function ficha(id) {
  cargando();
  const [r, hist] = await Promise.all([
    sb.from("ordenes_trabajo").select(SELECT).eq("id", id).maybeSingle(),
    sb.from("ot_historial").select("*").eq("orden_id", id).order("fecha"),
  ]);
  const volver = `<a href="#/ordenes" class="volver">← Órdenes de trabajo</a>`;
  if (r.error || !r.data) return vista(`${volver}<p class="vacio">${esc(r.error ? msgError(r.error) : "No se encontró la orden.")}</p>`);
  const o = r.data;
  const yo = soyAsignado(o), jefe = esJefe();
  const puedeTrabajar = (yo || jefe) && ["Asignada", "En curso"].includes(o.estado);
  const puedeEditar = jefe && (o.estado !== "Verificada" || esAdmin());
  const puedeSubir = esAdmin() || (o.estado !== "Verificada" && (yo || jefe));

  const v = vista(`${volver}
    <div class="panel"><div class="cabecera">
      <div><div class="muted small">${esc(num(o))} · ${esc(o.tipo)}</div><h1 style="margin:0">${esc(o.titulo)}</h1></div>
      <span>${chipPrioridad(o.prioridad)} ${chipOT(o.estado)}</span>
    </div></div>

    ${o.estado === "En curso" && o.devoluciones && o.obs_verificacion ? `
      <div class="panel" style="border-color:var(--warn)"><strong>Devuelta por el jefe</strong>
        <p style="margin:6px 0 0;white-space:pre-wrap">${esc(o.obs_verificacion)}</p></div>` : ""}
    ${o.estado === "Terminada" ? `
      <div class="panel" style="border-color:var(--warn)"><strong>Trabajo terminado, falta verificación</strong>
        <div class="muted small">${jefe ? "Revisa el informe y verifica o devuelve el trabajo." : "El jefe eléctrico o un administrador debe verificarlo."}</div></div>` : ""}

    <div class="panel"><h2>Datos</h2><dl class="datos">
      ${dato("Cliente", esc(o.clientes?.nombre || ""))}
      ${dato("Ubicación", esc(o.ubicacion || ""))}
      ${dato("Programada", o.fecha_programada ? fecha(o.fecha_programada) + (atrasada(o) ? ' <span class="chip mal">Atrasada</span>' : "") : "")}
      ${dato("A cargo", esc(nombres(o).join(", ")))}
      ${dato("Descripción", o.descripcion ? `<span style="white-space:pre-wrap">${esc(o.descripcion)}</span>` : "")}
    </dl></div>

    ${o.informe ? `<div class="panel"><h2>Informe del trabajo</h2>
      <p style="margin:0;white-space:pre-wrap">${esc(o.informe)}</p>
      ${o.materiales ? `<p class="muted small" style="margin:8px 0 0;white-space:pre-wrap"><b>Materiales:</b> ${esc(o.materiales)}</p>` : ""}
      ${o.estado === "Verificada" && o.obs_verificacion ? `<p class="muted small" style="margin:8px 0 0"><b>Obs. del jefe:</b> ${esc(o.obs_verificacion)}</p>` : ""}
    </div>` : ""}

    <div class="panel"><h2>Fotos y videos</h2>
      <div id="ot-fotos" class="galeria"></div><div id="ot-videos" class="videos"></div>
      ${puedeSubir ? `<div class="acciones" style="margin:0">
        <label class="btn subir">+ Agregar fotos<input type="file" id="ot-in-fotos" accept="image/*" multiple></label>
        <label class="btn subir">+ Agregar videos<input type="file" id="ot-in-videos" accept="video/*" multiple></label></div>
        <p class="muted small" style="margin:8px 0 0">Máximo 50 MB por video.</p>` : ""}
    </div>

    <div class="fila-acciones">
      ${puedeTrabajar && o.estado === "Asignada" ? `<button type="button" id="ot-iniciar">Iniciar trabajo</button>` : ""}
      ${puedeTrabajar ? `<button type="button" class="primary" id="ot-terminar">Marcar como terminado</button>` : ""}
      ${jefe && o.estado === "Terminada" ? `<button type="button" class="primary" id="ot-aprobar">Verificar y cerrar</button>
        <button type="button" id="ot-devolver">Devolver</button>` : ""}
      ${puedeEditar ? `<a class="btn" href="#/ordenes/${o.id}/editar">Editar</a>` : ""}
      ${esAdmin() ? `<button type="button" class="peligro" id="ot-eliminar">Eliminar</button>` : ""}
    </div>
    ${!yo && !jefe && o.estado !== "Verificada" ? `<p class="muted small">No estás asignado a esta orden.</p>` : ""}

    <div class="panel"><h2>Historial</h2>
      ${(hist.data || []).map((h) => `<div style="padding:6px 0;border-top:1px solid var(--line)">
        <strong>${esc(h.accion)}</strong> <span class="muted small">· ${esc(fmtHora(h.fecha))}${h.usuario ? " · " + esc(h.usuario) : ""}</span>
        ${h.detalle ? `<div class="small" style="white-space:pre-wrap">${esc(h.detalle)}</div>` : ""}</div>`).join("") || `<p class="muted small" style="margin:0">Sin movimientos.</p>`}
    </div>

    <dialog id="dlg-term"><form method="dialog" id="form-term">
      <h2>Marcar como terminado</h2>
      <label for="t-inf" class="req">¿Qué trabajo se realizó?</label><textarea id="t-inf" rows="5" required>${esc(o.informe || "")}</textarea>
      <label for="t-mat">Materiales usados</label><textarea id="t-mat" rows="2">${esc(o.materiales || "")}</textarea>
      <label for="t-arch">Fotos o videos del trabajo</label><input type="file" id="t-arch" accept="image/*,video/*" multiple>
      <p class="muted small">Quedará esperando la verificación del jefe eléctrico.</p>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Terminar</button></div>
    </form></dialog>
    <dialog id="dlg-dev"><form method="dialog" id="form-dev">
      <h2>Devolver trabajo</h2>
      <label for="d-obs" class="req">¿Qué falta o hay que corregir?</label><textarea id="d-obs" rows="4" required></textarea>
      <p class="muted small">La orden vuelve a "En curso" para el personal asignado.</p>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Devolver</button></div>
    </form></dialog>`);

  const rpc = async (fn, args, ok) => {
    const { error } = await sb.rpc(fn, args);
    if (error) return aviso(msgError(error), true);
    aviso(ok);
    ficha(id);
  };
  $$("[data-cerrar]", v).forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  $("#ot-iniciar", v) && ($("#ot-iniciar", v).onclick = () => rpc("ot_iniciar", { p_orden: id }, "Orden iniciada."));
  $("#ot-terminar", v) && ($("#ot-terminar", v).onclick = () => $("#dlg-term").showModal());
  $("#ot-in-fotos", v) && ($("#ot-in-fotos", v).onchange = (ev) => subirArchivos(o, ev.target.files, "foto").then(() => cargarMedios(o)));
  $("#ot-in-videos", v) && ($("#ot-in-videos", v).onchange = (ev) => subirArchivos(o, ev.target.files, "video").then(() => cargarMedios(o)));
  cargarMedios(o);
  $("#form-term", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const inf = $("#t-inf").value.trim();
    if (!inf) return aviso("Escribe qué trabajo se realizó.", true);
    const archivos = [...$("#t-arch").files];
    $("#dlg-term").close();
    // Primero los archivos (la orden aún está abierta), después se marca como terminada
    if (archivos.length) await subirArchivos(o, archivos);
    rpc("ot_terminar", { p_orden: id, p_informe: inf, p_materiales: $("#t-mat").value.trim() || null }, "Trabajo marcado como terminado.");
  };
  $("#ot-aprobar", v) && ($("#ot-aprobar", v).onclick = () => {
    const obs = prompt("Verificar y cerrar la orden. Comentario (opcional):", "");
    if (obs === null) return;
    rpc("ot_verificar", { p_orden: id, p_aprobar: true, p_obs: obs.trim() || null }, "Orden verificada y cerrada.");
  });
  $("#ot-devolver", v) && ($("#ot-devolver", v).onclick = () => $("#dlg-dev").showModal());
  $("#form-dev", v).onsubmit = (ev) => {
    ev.preventDefault();
    const obs = $("#d-obs").value.trim();
    if (!obs) return aviso("Indica qué falta o qué hay que corregir.", true);
    $("#dlg-dev").close();
    rpc("ot_verificar", { p_orden: id, p_aprobar: false, p_obs: obs }, "Trabajo devuelto.");
  };
  $("#ot-eliminar", v) && ($("#ot-eliminar", v).onclick = async () => {
    if (!confirm(`¿Eliminar la orden ${num(o)} con sus fotos y videos? No se puede deshacer.`)) return;
    const arch = await sb.from("ot_archivos").select("ruta").eq("orden_id", id);
    const { error } = await sb.from("ordenes_trabajo").delete().eq("id", id);
    if (error) return aviso(msgError(error), true);
    const rutas = (arch.data || []).map((x) => x.ruta);
    if (rutas.length) await sb.storage.from(BUCKET).remove(rutas);
    aviso("Orden eliminada.");
    location.hash = "#/ordenes";
  });
}

// ---------- Fotos y videos (tabla ot_archivos; ver js/medios.js) ----------
async function cargarMedios(o) {
  const { data, error } = await sb.from("ot_archivos").select("*").eq("orden_id", o.id).order("creado_en");
  const cf = $("#ot-fotos"), cv = $("#ot-videos");
  if (!cf || !cv) return; // el usuario cambió de pantalla
  if (error) {
    cf.innerHTML = `<p class="muted small" style="grid-column:1/-1;margin:0">${esc(msgCarga(error, "ot_archivos"))}</p>`;
    return;
  }
  await pintarMedios({
    bucket: BUCKET, items: data, cf, cv, alt: "Foto del trabajo", vacioFotos: data.length ? "" : "Sin fotos ni videos.",
    // Cada uno borra lo que subió mientras la orden no esté verificada; el admin, cualquiera
    puedeQuitar: (x) => esAdmin() || (x.subido_por === H.usuario.id && o.estado !== "Verificada"),
    alQuitar: async (x) => {
      if (await borrarMedio(BUCKET, x, () => sb.from("ot_archivos").delete().eq("id", x.id).select("id"))) cargarMedios(o);
    },
  });
}

const subirArchivos = (o, files, tipo) => subirMedios({
  bucket: BUCKET, carpeta: `${o.empresa_id}/${o.id}`, files, tipo,
  registrar: (ruta, t) => sb.from("ot_archivos").insert({ orden_id: o.id, ruta, tipo: t }),
});

// ---------- Formulario (jefe o admin) ----------
async function formulario(id) {
  cargando();
  let o = { titulo: "", tipo: tiposOrden()[0], prioridad: "Normal", cliente_id: "", ubicacion: "", fecha_programada: "", descripcion: "", ops: [] };
  const volver = id ? `#/ordenes/${id}` : "#/ordenes";
  if (id) {
    const { data, error } = await sb.from("ordenes_trabajo").select("*, orden_personal(personal_id)").eq("id", id).maybeSingle();
    if (error || !data) return vista(`<a href="#/ordenes" class="volver">← Órdenes de trabajo</a><p class="vacio">No se encontró la orden.</p>`);
    if (data.estado === "Verificada" && !esAdmin()) return vista(`<a href="${volver}" class="volver">← Volver</a><p class="vacio">La orden ya está verificada: solo un administrador puede modificarla.</p>`);
    o = { ...data, ops: data.orden_personal.map((x) => x.personal_id) };
  }
  const [clientes, pers] = await Promise.all([
    clientesEmpresa(),
    sb.from("personal").select("*").eq("empresa_id", H.empresa.id).order("nombre"),
  ]);
  const personal = (pers.data || []).filter((p) => p.activo || o.ops.includes(p.id));
  const tipos = [...new Set([...tiposOrden(), o.tipo])];
  const v = vista(`
    <a href="${volver}" class="volver">← Volver</a>
    <h1>${id ? "Editar orden de trabajo" : "Nueva orden de trabajo"}</h1>
    <form id="form-ot" class="panel" novalidate>
      <label for="f-titulo" class="req">Trabajo a realizar</label>
      <input id="f-titulo" value="${esc(o.titulo)}" placeholder="Ej.: Cambiar automáticos del tablero general" required>
      <div class="grid2">
        <div><label for="f-tipo" class="req">Tipo</label><select id="f-tipo">
          ${tipos.map((t) => `<option${t === o.tipo ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
        <div><label for="f-prio">Prioridad</label><select id="f-prio">
          ${PRIORIDADES.map((p) => `<option${p === o.prioridad ? " selected" : ""}>${p}</option>`).join("")}</select></div>
        <div><label for="f-cliente">Cliente</label><select id="f-cliente"><option value="">— Sin cliente —</option>
          ${clientes.map((c) => `<option value="${c.id}"${c.id === o.cliente_id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></div>
        <div><label for="f-fecha">Fecha programada</label><input id="f-fecha" type="date" value="${esc(o.fecha_programada || "")}"></div>
      </div>
      <label for="f-ubic">Ubicación / dirección</label><input id="f-ubic" value="${esc(o.ubicacion || "")}" placeholder="Ej.: Sala eléctrica, piso -1">
      <label for="f-desc">Detalle</label><textarea id="f-desc" rows="4">${esc(o.descripcion || "")}</textarea>
      <label class="req">A cargo</label>
      <div class="checks" id="f-ops">
        ${personal.map((p) => `<label><input type="checkbox" value="${p.id}"${o.ops.includes(p.id) ? " checked" : ""}>${esc(p.nombre)}</label>`).join("")
          || `<span class="muted small">No hay personal registrado. ${esAdmin() ? `<a href="#/admin/personal">Agregar personal</a>` : "Pide al administrador que lo agregue."}</span>`}
      </div>
      <div class="ayuda">Solo quienes tienen cuenta vinculada en Personal pueden iniciar y terminar la orden desde la app.</div>
      <div class="guardar"><a class="btn" href="${volver}">Cancelar</a>
        <button class="primary" type="submit" id="btn-guardar">${id ? "Guardar cambios" : "Crear orden"}</button></div>
    </form>`);

  $("#form-ot", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const titulo = $("#f-titulo").value.trim();
    const ops = $$("#f-ops input:checked").map((i) => i.value);
    if (!titulo) return aviso("Indica el trabajo a realizar.", true);
    if (!ops.length) return aviso("Elige al menos una persona a cargo.", true);
    const fila = {
      titulo, tipo: $("#f-tipo").value, prioridad: $("#f-prio").value, cliente_id: $("#f-cliente").value || null,
      fecha_programada: $("#f-fecha").value || null, ubicacion: $("#f-ubic").value.trim() || null,
      descripcion: $("#f-desc").value.trim() || null,
    };
    const btn = $("#btn-guardar");
    btn.disabled = true;
    let oid = id, r;
    if (id) r = await sb.from("ordenes_trabajo").update(fila).eq("id", id);
    else { r = await sb.from("ordenes_trabajo").insert({ ...fila, empresa_id: H.empresa.id }).select("id").single(); oid = r.data?.id; }
    if (r.error) { btn.disabled = false; return aviso("Error al guardar: " + msgError(r.error), true); }
    const quitar = o.ops.filter((x) => !ops.includes(x)), agregar = ops.filter((x) => !o.ops.includes(x));
    if (quitar.length) {
      const d = await sb.from("orden_personal").delete().eq("orden_id", oid).in("personal_id", quitar);
      if (d.error) { btn.disabled = false; return aviso("Error al quitar personal: " + msgError(d.error), true); }
    }
    if (agregar.length) {
      const i = await sb.from("orden_personal").insert(agregar.map((personal_id) => ({ orden_id: oid, personal_id })));
      if (i.error) { btn.disabled = false; return aviso("Error al asignar personal: " + msgError(i.error), true); }
    }
    aviso(id ? "Cambios guardados." : "Orden creada.");
    location.hash = "#/ordenes/" + oid;
  };
}

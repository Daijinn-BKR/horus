// Horus · Equipos (motores y bombas): fichas, mediciones, fotos/videos y QR
import {
  sb, H, OPC, $, $$, esc, aviso, msgError, vista, cargando, alSalirDeVista, fecha, fechaHora, hoy,
  chipEstado, unicos, linkEquipo, qrUrl, descargarCSV, clientesEmpresa, esAdmin, esStaff, esCliente,
  abrirLector, cerrarLector,
} from "./nucleo.js";
import { fichaLimitadaHTML } from "./publico.js";

const BUCKET = "equipos";
const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB, límite del plan gratis

const GENERAL = [
  { k: "tipo_motor", l: "Tipo de motor", op: "tipo_motor" },
  { k: "tipo_voltaje", l: "Tipo de voltaje" },
  { k: "tipo_mantenimiento", l: "Tipo de mantenimiento", op: "tipo_mantenimiento" },
  { k: "encargados", l: "Encargado/s" },
];
const MEDICIONES = [
  ["t_u", "T-U"], ["t_v", "T-V"], ["t_w", "T-W"],
  ["u_v", "U-V"], ["u_w", "U-W"], ["v_w", "V-W"],
  ["u_x", "U-X"], ["v_y", "V-Y"], ["w_z", "W-Z"],
];
const COMPONENTES = [
  { k: "rodamientos", l: "Rodamientos", op: "rodamientos" },
  { k: "sello", l: "Sello" },
  { k: "reten", l: "Retén" },
  { k: "placa_bornera", l: "Placa bornera" },
];
const CIERRE = [
  { k: "proceso", l: "Proceso", area: true },
  { k: "notas", l: "Notas adicionales", area: true },
];
const TEXTO = [...GENERAL, ...COMPONENTES, ...CIERRE, { k: "estado", l: "Estado" }];

export const rutas = [
  { patron: /^#\/equipos$/, modulo: "equipos", render: () => (esCliente() ? listaCliente() : lista()) },
  { patron: /^#\/equipos\/nuevo$/, modulo: "equipos", acceso: "staff", render: () => formulario(null) },
  { patron: /^#\/equipos\/([^/]+)\/editar$/, modulo: "equipos", acceso: "staff", render: (id) => formulario(id) },
  { patron: /^#\/equipos\/([^/]+)$/, modulo: "equipos", render: (id) => (esCliente() ? fichaCliente(id) : ficha(id)) },
  { patron: /^#\/escanear$/, modulo: "equipos", acceso: "staff", render: () => escaner() },
];

let equipos = []; // cache de la empresa activa
const numero = (v) => (v == null ? "—" : String(v).replace(".", ","));
const nombreCliente = (e) => e.clientes?.nombre || "(sin cliente)";
const opciones = (op) => unicos([...(OPC[op] || []), ...equipos.map((e) => e[op])]);

// ---------- Lista (personal) ----------
async function cargarEquipos() {
  const { data, error } = await sb.from("equipos").select("*, clientes(nombre)")
    .eq("empresa_id", H.empresa.id).order("creado_en", { ascending: false });
  if (error) { aviso(msgError(error), true); return false; }
  equipos = data;
  return true;
}

async function lista() {
  cargando();
  if (!(await cargarEquipos())) return;
  const clientes = await clientesEmpresa();
  vista(`
    <div class="acciones">
      <a class="btn primary" href="#/equipos/nuevo">+ Nuevo equipo</a>
      <a class="btn" href="#/escanear">Escanear QR</a>
      <button id="btn-csv">Exportar CSV</button>
    </div>
    <div class="filtros">
      <input id="buscar" type="search" placeholder="Buscar por cliente, motor, encargado o ID…" aria-label="Buscar">
      <select id="f-cliente" aria-label="Cliente"><option value="">Todos los clientes</option>
        ${clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select>
      <select id="f-estado" aria-label="Estado"></select>
    </div>
    <div id="fuera"></div>
    <p id="conteo" class="muted small"></p>
    <div id="lista" class="lista"></div>`);
  pintarFuera();
  const estados = () => {
    const sel = $("#f-estado"), v = sel.value;
    sel.innerHTML = `<option value="">Todos los estados</option>` + opciones("estado").map((o) => `<option>${esc(o)}</option>`).join("");
    sel.value = v;
  };
  const pintar = () => {
    const q = $("#buscar").value.trim().toLowerCase(), est = $("#f-estado").value, cli = $("#f-cliente").value;
    const l = equipos.filter((e) => (!est || e.estado === est) && (!cli || e.cliente_id === cli) &&
      (!q || [e.id, nombreCliente(e), e.tipo_motor, e.tipo_voltaje, e.tipo_mantenimiento, e.encargados]
        .some((v) => String(v ?? "").toLowerCase().includes(q))));
    $("#conteo").textContent = `${l.length} de ${equipos.length} equipos`;
    $("#lista").innerHTML = l.length ? l.map((e) => `
      <a class="tarjeta" href="#/equipos/${encodeURIComponent(e.id)}">
        <div class="t-top"><strong>${esc(nombreCliente(e))}</strong>${chipEstado(e.estado)}</div>
        <div class="muted">${esc(e.tipo_motor || "")}${e.tipo_voltaje ? " · " + esc(e.tipo_voltaje) : ""}</div>
        <div class="muted small">ID ${esc(e.id)} · ${fecha(e.creado_en)}${e.encargados ? " · " + esc(e.encargados) : ""}</div>
      </a>`).join("")
      : `<p class="vacio">${equipos.length ? "No hay equipos que coincidan." : "Todavía no hay equipos. Toca “+ Nuevo equipo”."}</p>`;
  };
  estados(); pintar();
  ["#buscar", "#f-estado", "#f-cliente"].forEach((s) => $(s).addEventListener("input", pintar));
  $("#btn-csv").onclick = exportarCSV;

  // Tiempo real: lo que registra otra persona aparece sin recargar
  let t;
  const canal = sb.channel("equipos-lista")
    .on("postgres_changes", { event: "*", schema: "public", table: "equipos" }, () => {
      clearTimeout(t);
      t = setTimeout(async () => { if (await cargarEquipos()) { estados(); pintar(); } }, 300);
    }).subscribe();
  alSalirDeVista(() => { clearTimeout(t); sb.removeChannel(canal); });
}

function exportarCSV() {
  const cols = [
    ["id", "ID_Equipo"], ["cliente", "Cliente"], ["tipo_motor", "Tipo_de_motor"], ["tipo_voltaje", "Tipo_de_Voltaje"],
    ["tipo_mantenimiento", "Tipo_de_Mantenimiento"], ["encargados", "Encargado/s"],
    ...MEDICIONES.map(([k]) => [k, k.toUpperCase()]),
    ["rodamientos", "Rodamientos"], ["sello", "Sello"], ["reten", "Reten"], ["placa_bornera", "Placa_Bornera"],
    ["proceso", "Proceso"], ["notas", "Notas_Adicionales"], ["estado", "Estado"],
    ["creado_en", "Creado"], ["actualizado_en", "Modificado"],
  ];
  descargarCSV("equipos", cols.map((c) => c[1]),
    equipos.map((e) => cols.map(([k]) => (k === "cliente" ? nombreCliente(e) : e[k]))));
}

// ---------- Ficha completa (personal) ----------
async function buscarEquipo(id) {
  const { data, error } = await sb.from("equipos").select("*, clientes(nombre)").eq("id", id).maybeSingle();
  if (error) { aviso(msgError(error), true); return null; }
  // El admin puede abrir el QR de un equipo de otra empresa: se cambia a esa empresa
  if (data && data.empresa_id !== H.empresa.id && esAdmin() && window.horusCambiarEmpresa(data.empresa_id)) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return CAMBIO;
  }
  return data;
}
const CAMBIO = Symbol("cambio de empresa");

const filaDato = (c, e) =>
  `<dt>${esc(c.l)}</dt><dd>${e[c.k] == null || e[c.k] === "" ? '<span class="muted">—</span>' : esc(e[c.k])}</dd>`;

async function ficha(id, refresco = false) {
  if (!refresco) cargando();
  const e = await buscarEquipo(id);
  if (e === CAMBIO) return;
  if (!e) { if (!refresco) vista(`<a href="#/equipos" class="volver">← Equipos</a><p class="vacio">No existe un equipo con ID ${esc(id)}.</p>`); return; }
  const link = linkEquipo(e.id);
  const v = vista(`
    <a href="#/equipos" class="volver">← Equipos</a>
    <div class="panel"><div class="cabecera">
      <div><h1 style="margin:0">${esc(nombreCliente(e))}</h1><div class="muted">${esc(e.tipo_motor || "")}</div></div>
      ${chipEstado(e.estado)}
    </div></div>

    <div class="panel qr-panel">
      <img src="${qrUrl(link)}" alt="Código QR del equipo ${esc(e.id)}">
      <div>
        <div class="muted small">ID del equipo</div>
        <div style="font-size:22px;font-weight:700;letter-spacing:1px;margin-bottom:8px">${esc(e.id)}</div>
        <div class="botones">
          <button type="button" id="btn-imprimir" class="primary">Imprimir etiqueta QR</button>
          <button type="button" id="btn-copiar">Copiar enlace</button>
        </div>
      </div>
    </div>

    <div class="panel" id="mext"><h2>Mantención externa</h2><p class="muted small" style="margin:0">Cargando…</p></div>

    <div class="panel"><h2>Datos</h2><dl class="datos">
      <dt>Cliente</dt><dd>${esc(nombreCliente(e))}</dd>${GENERAL.map((c) => filaDato(c, e)).join("")}</dl></div>
    <div class="panel"><h2>Mediciones</h2><div class="medidas">
      ${MEDICIONES.map(([k, l]) => `<div class="medida"><b>${numero(e[k])}</b><span>${l}</span></div>`).join("")}</div></div>
    <div class="panel"><h2>Componentes</h2><dl class="datos">${COMPONENTES.map((c) => filaDato(c, e)).join("")}</dl></div>
    <div class="panel"><h2>Proceso y notas</h2><dl class="datos">${CIERRE.map((c) => filaDato(c, e)).join("")}</dl></div>

    <div class="panel"><h2>Fotos</h2><div id="fotos" class="galeria"></div>
      <label class="btn subir">+ Agregar fotos<input type="file" id="in-fotos" accept="image/*" multiple></label></div>
    <div class="panel"><h2>Videos</h2><div id="videos" class="videos"></div>
      <label class="btn subir">+ Agregar video<input type="file" id="in-videos" accept="video/*" multiple></label>
      <p class="muted small" style="margin:8px 0 0">Máximo 50 MB por video.</p></div>

    <div class="fila-acciones">
      <a class="btn primary" href="#/equipos/${encodeURIComponent(e.id)}/editar">Editar</a>
      ${esAdmin() ? `<button type="button" class="peligro" id="btn-eliminar">Eliminar equipo</button>` : ""}
    </div>
    <p class="muted small">Creado ${fecha(e.creado_en)} · Última modificación ${fecha(e.actualizado_en)}</p>`);

  $("#btn-imprimir", v).onclick = () => imprimirEtiqueta(e);
  $("#btn-copiar", v).onclick = async () => {
    try { await navigator.clipboard.writeText(link); aviso("Enlace copiado."); }
    catch { prompt("Copia el enlace:", link); }
  };
  if (esAdmin()) $("#btn-eliminar", v).onclick = () => eliminarEquipo(e);
  $("#in-fotos", v).onchange = (ev) => subirArchivos(e, ev.target.files, "foto");
  $("#in-videos", v).onchange = (ev) => subirArchivos(e, ev.target.files, "video");
  cargarMedios(e.id);
  cargarExterna(e);

  if (!refresco) {
    const canal = sb.channel("equipo-" + e.id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "equipos", filter: `id=eq.${e.id}` },
        () => { if (!document.querySelector("#vista input:focus")) ficha(e.id, true); })
      .subscribe();
    alSalirDeVista(() => sb.removeChannel(canal));
  }
}

// ---------- Mantención externa: equipos que salen del taller y vuelven ----------
const diasFuera = (m) =>
  Math.max(0, Math.round((new Date((m.fecha_retorno || hoy()) + "T12:00:00") - new Date(m.fecha_salida + "T12:00:00")) / 864e5));
const txtDias = (n) => `${n} día${n === 1 ? "" : "s"}`;
const vencido = (m) => !m.fecha_retorno && m.fecha_estimada && m.fecha_estimada < hoy();

// Aviso en la lista: cuántos equipos están fuera y cuáles pasaron la fecha estimada de retorno
async function pintarFuera() {
  const { data, error } = await sb.from("mantenciones_externas").select("equipo_id, destino, fecha_salida, fecha_estimada, fecha_retorno")
    .eq("empresa_id", H.empresa.id).is("fecha_retorno", null).order("fecha_salida");
  const c = $("#fuera");
  if (!c || error || !data.length) return; // sin la versión nueva de schema.sql la tabla no existe: no se muestra nada
  const atrasados = data.filter(vencido).length;
  c.innerHTML = `<details class="panel" style="border-color:var(--warn)"><summary><strong>${data.length} equipo${data.length === 1 ? "" : "s"} en mantención externa</strong>
      ${atrasados ? ` <span class="chip mal">${atrasados} atrasado${atrasados === 1 ? "" : "s"}</span>` : ""}</summary>
    <div class="lista" style="margin-top:8px">${data.map((m) => `
      <a class="tarjeta" href="#/equipos/${encodeURIComponent(m.equipo_id)}">
        <div class="t-top"><strong>ID ${esc(m.equipo_id)} · ${esc(m.destino)}</strong>${vencido(m) ? `<span class="chip mal">Atrasado</span>` : ""}</div>
        <div class="muted small">Salió ${fecha(m.fecha_salida)} · ${txtDias(diasFuera(m))} fuera${m.fecha_estimada ? ` · Retorno estimado ${fecha(m.fecha_estimada)}` : ""}</div>
      </a>`).join("")}</div></details>`;
}

async function cargarExterna(e) {
  const c = $("#mext");
  if (!c) return;
  const { data, error } = await sb.from("mantenciones_externas").select("*").eq("equipo_id", e.id).order("fecha_salida", { ascending: false });
  if (error) { c.hidden = true; return; } // tabla aún no creada en Supabase
  const abierta = data.find((m) => !m.fecha_retorno);
  const pasadas = data.filter((m) => m.fecha_retorno);
  const estadosRetorno = unicos([...(OPC.estado || []), "En mantención", "Terminado", "Entregado"]).filter((x) => x !== "En mantención externa");
  c.innerHTML = `<h2>Mantención externa</h2>
    ${abierta ? `
      <div class="t-top"><strong>Fuera del taller: ${esc(abierta.destino)}</strong>
        ${vencido(abierta) ? `<span class="chip mal">Atrasado</span>` : `<span class="chip warn">Fuera</span>`}</div>
      <dl class="datos">
        <dt>Salió</dt><dd>${fecha(abierta.fecha_salida)} (${txtDias(diasFuera(abierta))})</dd>
        <dt>Retorno estimado</dt><dd>${abierta.fecha_estimada ? fecha(abierta.fecha_estimada) : '<span class="muted">—</span>'}</dd>
        ${abierta.contacto ? `<dt>Contacto</dt><dd>${esc(abierta.contacto)}</dd>` : ""}
        ${abierta.guia_salida ? `<dt>Guía de despacho</dt><dd>${esc(abierta.guia_salida)}</dd>` : ""}
        ${abierta.motivo ? `<dt>Motivo</dt><dd style="white-space:pre-wrap">${esc(abierta.motivo)}</dd>` : ""}
      </dl>
      <div class="botones"><button type="button" class="primary" id="mx-retorno">Registrar retorno</button></div>`
    : `<p class="muted small" style="margin:0 0 8px">El equipo está en el taller.</p>
       <div class="botones"><button type="button" id="mx-enviar">Enviar a mantención externa</button></div>`}
    ${pasadas.length ? `<details style="margin-top:10px"><summary class="small">Envíos anteriores (${pasadas.length})</summary>
      ${pasadas.map((m) => `<div style="padding:6px 0;border-top:1px solid var(--line)">
        <strong>${esc(m.destino)}</strong> <span class="muted small">· ${fecha(m.fecha_salida)} → ${fecha(m.fecha_retorno)} (${txtDias(diasFuera(m))})</span>
        ${m.motivo ? `<div class="small">Motivo: ${esc(m.motivo)}</div>` : ""}
        ${m.notas_retorno ? `<div class="small">Al volver: ${esc(m.notas_retorno)}</div>` : ""}</div>`).join("")}</details>` : ""}

    <dialog id="dlg-mx-env"><form method="dialog" id="form-mx-env">
      <h2>Enviar a mantención externa</h2>
      <label for="mx-dest" class="req">¿A dónde va?</label><input id="mx-dest" placeholder="Taller o empresa" required>
      <label for="mx-cont">Contacto</label><input id="mx-cont" placeholder="Nombre / teléfono">
      <div class="grid2">
        <div><label for="mx-sal" class="req">Fecha de salida</label><input id="mx-sal" type="date" value="${hoy()}"></div>
        <div><label for="mx-est">Retorno estimado</label><input id="mx-est" type="date"></div>
      </div>
      <label for="mx-guia">N° guía de despacho</label><input id="mx-guia">
      <label for="mx-mot">Motivo / qué se le hará</label><textarea id="mx-mot" rows="3"></textarea>
      <p class="muted small">El equipo quedará en estado "En mantención externa".</p>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Registrar salida</button></div>
    </form></dialog>
    <dialog id="dlg-mx-ret"><form method="dialog" id="form-mx-ret">
      <h2>Registrar retorno</h2>
      <label for="mx-fret" class="req">Fecha de retorno</label><input id="mx-fret" type="date" value="${hoy()}">
      <label for="mx-gret">N° guía de retorno</label><input id="mx-gret">
      <label for="mx-nret">¿Qué se le hizo? / observaciones</label><textarea id="mx-nret" rows="3"></textarea>
      <label for="mx-eret">Estado del equipo al volver</label><select id="mx-eret">
        ${estadosRetorno.map((x) => `<option${x === "En mantención" ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Registrar retorno</button></div>
    </form></dialog>`;
  $$("[data-cerrar]", c).forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  if ($("#mx-enviar", c)) $("#mx-enviar", c).onclick = () => $("#dlg-mx-env").showModal();
  if ($("#mx-retorno", c)) $("#mx-retorno", c).onclick = () => $("#dlg-mx-ret").showModal();
  $("#form-mx-env", c).onsubmit = async (ev) => {
    ev.preventDefault();
    const destino = $("#mx-dest").value.trim(), sal = $("#mx-sal").value, est = $("#mx-est").value;
    if (!destino) return aviso("Indica a dónde va el equipo.", true);
    if (!sal) return aviso("Indica la fecha de salida.", true);
    if (est && est < sal) return aviso("El retorno estimado no puede ser antes de la salida.", true);
    const { error } = await sb.from("mantenciones_externas").insert({
      equipo_id: e.id, empresa_id: e.empresa_id, destino, contacto: $("#mx-cont").value.trim() || null,
      fecha_salida: sal, fecha_estimada: est || null, guia_salida: $("#mx-guia").value.trim() || null,
      motivo: $("#mx-mot").value.trim() || null,
    });
    if (error) return aviso(msgError(error), true);
    $("#dlg-mx-env").close();
    aviso("Salida registrada.");
    ficha(e.id, true);
  };
  $("#form-mx-ret", c).onsubmit = async (ev) => {
    ev.preventDefault();
    const fret = $("#mx-fret").value;
    if (!fret) return aviso("Indica la fecha de retorno.", true);
    if (fret < abierta.fecha_salida) return aviso("La fecha de retorno es anterior a la salida.", true);
    const { error } = await sb.from("mantenciones_externas").update({
      fecha_retorno: fret, guia_retorno: $("#mx-gret").value.trim() || null,
      notas_retorno: $("#mx-nret").value.trim() || null, estado_retorno: $("#mx-eret").value,
    }).eq("id", abierta.id);
    if (error) return aviso(msgError(error), true);
    $("#dlg-mx-ret").close();
    aviso("Retorno registrado.");
    ficha(e.id, true);
  };
}

async function cargarMedios(id) {
  const [f, v] = await Promise.all([
    sb.from("fotos_equipo").select("*").eq("equipo_id", id).order("creado_en"),
    sb.from("videos_equipo").select("*").eq("equipo_id", id).order("creado_en"),
  ]);
  if (f.error || v.error) { aviso(msgError(f.error || v.error), true); return; }
  const firmadas = {};
  const rutasArch = [...f.data, ...v.data].map((x) => x.ruta);
  if (rutasArch.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(rutasArch, 3600);
    if (!error) data.forEach((d) => { if (d.signedUrl) firmadas[d.path] = d.signedUrl; });
  }
  const cf = $("#fotos"), cv = $("#videos");
  if (!cf || !cv) return; // el usuario cambió de pantalla
  const quitar = (tabla, x, txt) => esAdmin()
    ? `<button type="button" class="quitar" data-tabla="${tabla}" data-id="${x.id}" data-ruta="${esc(x.ruta)}" aria-label="${txt}">✕</button>` : "";
  cf.innerHTML = f.data.length ? f.data.map((x) => `
    <figure><a href="${esc(firmadas[x.ruta] || "#")}" target="_blank" rel="noopener">
      <img loading="lazy" src="${esc(firmadas[x.ruta] || "")}" alt="Foto del equipo"></a>
      ${quitar("fotos_equipo", x, "Borrar foto")}</figure>`).join("")
    : `<p class="muted small" style="grid-column:1/-1;margin:0">Sin fotos.</p>`;
  cv.innerHTML = v.data.length ? v.data.map((x) => `
    <figure><video controls preload="metadata" playsinline src="${esc(firmadas[x.ruta] || "")}"></video>
      ${quitar("videos_equipo", x, "Borrar video")}</figure>`).join("")
    : `<p class="muted small" style="margin:0">Sin videos.</p>`;
  for (const b of $$("#vista .quitar")) b.onclick = () => borrarMedio(b.dataset.tabla, b.dataset.id, b.dataset.ruta, id);
}

async function borrarMedio(tabla, mid, ruta, equipoId) {
  if (!confirm(tabla === "fotos_equipo" ? "¿Borrar esta foto?" : "¿Borrar este video?")) return;
  const { error } = await sb.from(tabla).delete().eq("id", mid);
  if (error) { aviso(msgError(error), true); return; }
  await sb.storage.from(BUCKET).remove([ruta]);
  aviso("Borrado.");
  cargarMedios(equipoId);
}

// Reduce las fotos del celular (4–10 MB) a ~300 KB
async function reducirImagen(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82))) || file;
  } catch {
    return file;
  }
}

async function subirArchivos(e, files, tipo) {
  const lista = [...(files || [])];
  if (!lista.length) return;
  const tabla = tipo === "foto" ? "fotos_equipo" : "videos_equipo";
  let ok = 0;
  for (let i = 0; i < lista.length; i++) {
    const file = lista[i];
    aviso(`Subiendo ${tipo} ${i + 1} de ${lista.length}…`);
    let blob = file;
    let ext = (file.name.includes(".") ? file.name.split(".").pop() : "").toLowerCase() || "bin";
    if (tipo === "foto") {
      blob = await reducirImagen(file);
      if (blob !== file) ext = "jpg";
    } else if (file.size > MAX_VIDEO) {
      aviso(`“${file.name}” pesa más de 50 MB. Grábalo más corto o en menor calidad.`, true);
      continue;
    }
    const ruta = `${e.empresa_id}/${e.id}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type || file.type || undefined });
    if (up.error) { aviso("No se pudo subir: " + msgError(up.error), true); continue; }
    const ins = await sb.from(tabla).insert({ equipo_id: e.id, ruta });
    if (ins.error) { aviso("No se pudo guardar: " + msgError(ins.error), true); continue; }
    ok++;
  }
  if (ok) aviso(ok === 1 ? `${tipo === "foto" ? "Foto subida" : "Video subido"}.` : `${ok} archivos subidos.`);
  if ($("#fotos")) cargarMedios(e.id);
}

// Impresora del taller (3nStar RPT004): servicio local impresora-taller/ que imprime con el QR
// nativo de la impresora. Si no está instalado (celular, otro PC), se usa window.print().
const IMPRESORA_LOCAL = "http://127.0.0.1:9101";
// Misma clave que usaba Control Equipos (mismo dominio): el PC del taller ya queda reconocido.
const marcaLocal = () => { try { localStorage.setItem("impresora_local", "1"); } catch (_) {} };
const esPcTaller = () => { try { return localStorage.getItem("impresora_local") === "1"; } catch (_) { return false; } };

async function imprimirLocal(e) {
  const r = await fetch(IMPRESORA_LOCAL + "/imprimir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      qr: linkEquipo(e.id),
      id: e.id,
      cliente: e.clientes?.nombre || "",
      fecha: fechaHora(e.creado_en),
      empresa: (H.empresa?.nombre || "").toUpperCase(),
      copias: 1,
    }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "error " + r.status);
}

async function imprimirEtiqueta(e) {
  try {
    await imprimirLocal(e);
    marcaLocal();
    aviso("Etiqueta enviada a la impresora.");
    return;
  } catch (_) {
    // En el PC del taller no se cae a window.print(): la RPT004 imprimiría basura.
    if (esPcTaller()) { aviso("La impresora del taller no responde. ¿Está encendida y con papel?", true); return; }
  }
  const et = $("#etiqueta");
  const src = qrUrl(linkEquipo(e.id), 480, "&dark=000000&light=ffffff").replace("margin=1", "margin=2");
  et.innerHTML = `
    <img alt="" src="${src}">
    <div class="id">${esc(e.id)}</div>
    ${e.clientes?.nombre ? `<div class="cli">${esc(e.clientes.nombre)}</div>` : ""}
    <div class="fec">Ingreso: ${esc(fechaHora(e.creado_en))}</div>
    <div class="emp">${esc((H.empresa?.nombre || "").toUpperCase())}</div>`;
  const img = $("img", et);
  const lanzar = () => setTimeout(() => window.print(), 100);
  if (img.complete) lanzar();
  else { img.onload = lanzar; img.onerror = () => aviso("No se pudo generar el QR (¿sin internet?).", true); }
}

async function eliminarEquipo(e) {
  if (!confirm(`¿Eliminar el equipo ${e.id} (${nombreCliente(e)}) con todas sus fotos y videos? No se puede deshacer.`)) return;
  const [f, v] = await Promise.all([
    sb.from("fotos_equipo").select("ruta").eq("equipo_id", e.id),
    sb.from("videos_equipo").select("ruta").eq("equipo_id", e.id),
  ]);
  const { error } = await sb.from("equipos").delete().eq("id", e.id);
  if (error) { aviso(msgError(error), true); return; }
  const rutasArch = [...(f.data || []), ...(v.data || [])].map((x) => x.ruta);
  if (rutasArch.length) await sb.storage.from(BUCKET).remove(rutasArch);
  aviso("Equipo eliminado.");
  location.hash = "#/equipos";
}

// ---------- Formulario ----------
function campoHTML(c, val) {
  const id = "f-" + c.k;
  const lab = `<label for="${id}">${esc(c.l)}</label>`;
  if (c.area) return `${lab}<textarea id="${id}" name="${c.k}">${esc(val)}</textarea>`;
  const lst = c.op ? ` list="dl-${c.op}"` : "";
  const dl = c.op ? `<datalist id="dl-${c.op}">${opciones(c.op).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
  return `${lab}<input id="${id}" name="${c.k}" type="text" autocomplete="off"${lst} value="${esc(val)}">${dl}`;
}

async function formulario(id) {
  cargando();
  let e = null;
  if (id) {
    e = await buscarEquipo(id);
    if (e === CAMBIO) return;
    if (!e) { vista(`<a href="#/equipos" class="volver">← Equipos</a><p class="vacio">No existe un equipo con ID ${esc(id)}.</p>`); return; }
  }
  if (!equipos.length) await cargarEquipos();
  const clientes = await clientesEmpresa();
  const volver = e ? "#/equipos/" + encodeURIComponent(e.id) : "#/equipos";
  if (!clientes.length) {
    vista(`<a href="${volver}" class="volver">← Volver</a><div class="panel"><h2>Primero hay que crear clientes</h2>
      <p class="muted">Cada equipo pertenece a un cliente. ${esAdmin() ? `<a href="#/admin/clientes">Crear clientes</a>.` : "Pide al administrador que agregue el cliente."}</p></div>`);
    return;
  }
  const val = (k) => (e ? e[k] ?? "" : "");
  const estados = opciones("estado");
  const estadoActual = e ? e.estado ?? "" : (estados[0] || "");
  const v = vista(`
    <a href="${volver}" class="volver">← Volver</a>
    <h1>${e ? `Editar equipo ${esc(e.id)}` : "Nuevo equipo"}</h1>
    <form id="form-equipo" novalidate>
      <div class="panel"><h2>Datos del equipo</h2>
        <label for="f-cliente" class="req">Cliente</label>
        <select id="f-cliente" name="cliente_id" required><option value="">— Selecciona —</option>
          ${clientes.map((c) => `<option value="${c.id}"${e?.cliente_id === c.id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}
        </select>
        <div class="grid2">${GENERAL.map((c) => `<div>${campoHTML(c, val(c.k))}</div>`).join("")}</div>
      </div>
      <div class="panel"><h2>Mediciones</h2><div class="medidas-form">
        ${MEDICIONES.map(([k, l]) => `<div><label for="f-${k}">${l}</label>
          <input id="f-${k}" name="${k}" type="text" inputmode="decimal" autocomplete="off"
            value="${e && e[k] != null ? esc(String(e[k]).replace(".", ",")) : ""}"></div>`).join("")}
      </div></div>
      <div class="panel"><h2>Componentes</h2>
        <div class="grid2">${COMPONENTES.map((c) => `<div>${campoHTML(c, val(c.k))}</div>`).join("")}</div></div>
      <div class="panel"><h2>Proceso y estado</h2>
        ${CIERRE.map((c) => campoHTML(c, val(c.k))).join("")}
        <label for="f-estado">Estado</label>
        <select id="f-estado" name="estado"><option value="">(sin estado)</option>
          ${unicos([...estados, estadoActual]).map((o) => `<option${o === estadoActual ? " selected" : ""}>${esc(o)}</option>`).join("")}
        </select></div>
      ${e ? "" : `<div class="panel"><h2>Fotos</h2><input type="file" name="fotos" accept="image/*" multiple>
        <p class="muted small" style="margin:6px 0 0">Opcional. También puedes agregar fotos y videos después, desde la ficha.</p></div>`}
      <div class="guardar"><a class="btn" href="${volver}">Cancelar</a>
        <button type="submit" class="primary" id="btn-guardar">${e ? "Guardar cambios" : "Guardar equipo"}</button></div>
    </form>`);
  $("#f-cliente", v).focus();

  $("#form-equipo", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const datos = { cliente_id: f.elements.cliente_id.value || null };
    if (!datos.cliente_id) { aviso("Falta el cliente.", true); f.elements.cliente_id.focus(); return; }
    for (const c of TEXTO) {
      const x = (f.elements[c.k]?.value ?? "").trim();
      datos[c.k] = x === "" ? null : x;
    }
    for (const [k, l] of MEDICIONES) {
      const x = f.elements[k].value.trim().replace(",", ".");
      if (x === "") { datos[k] = null; continue; }
      const n = Number(x);
      if (!Number.isFinite(n)) { aviso(`La medición ${l} no es un número.`, true); f.elements[k].focus(); return; }
      datos[k] = n;
    }
    const btn = $("#btn-guardar");
    btn.disabled = true;
    const res = e
      ? await sb.from("equipos").update(datos).eq("id", e.id).select("*").single()
      : await sb.from("equipos").insert({ ...datos, empresa_id: H.empresa.id }).select("*").single();
    if (res.error) { btn.disabled = false; aviso("No se pudo guardar: " + msgError(res.error), true); return; }
    const fotos = f.elements.fotos?.files;
    if (fotos && fotos.length) await subirArchivos(res.data, fotos, "foto");
    aviso(e ? "Cambios guardados." : `Equipo ${res.data.id} creado.`);
    location.hash = "#/equipos/" + encodeURIComponent(res.data.id);
  };
}

// ---------- Escáner ----------
function extraerId(texto) {
  const t = String(texto).trim();
  const m = t.match(/#\/e\/([^/?#&]+)/) || t.match(/[#&?](?:equipo|row)=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : t;
}

async function escaner() {
  vista(`<a href="#/equipos" class="volver">← Equipos</a><h1>Escanear QR</h1><div id="lector"></div>
    <p class="muted" style="text-align:center">Apunta la cámara al QR pegado en el equipo.</p>`);
  try {
    await abrirLector("lector", (texto) => { location.hash = "#/equipos/" + encodeURIComponent(extraerId(texto)); });
  } catch {
    aviso("No se pudo abrir la cámara. Revisa que la página tenga permiso de cámara (requiere HTTPS).", true);
  }
  alSalirDeVista(() => cerrarLector());
}

// ---------- Vista del cliente (solo lectura, datos limitados) ----------
async function listaCliente() {
  cargando();
  const { data, error } = await sb.rpc("mis_equipos");
  if (error) { aviso(msgError(error), true); return; }
  vista(`<h1>Mis equipos</h1>
    <input id="buscar" type="search" placeholder="Buscar por motor, estado o ID…" aria-label="Buscar">
    <div id="lista" class="lista"></div>`);
  const pintar = () => {
    const q = $("#buscar").value.trim().toLowerCase();
    const l = data.filter((e) => !q || [e.id, e.tipo_motor, e.estado, e.tipo_mantenimiento].some((v) => String(v ?? "").toLowerCase().includes(q)));
    $("#lista").innerHTML = l.length ? l.map((e) => `
      <a class="tarjeta" href="#/equipos/${encodeURIComponent(e.id)}">
        <div class="t-top"><strong>${esc(e.tipo_motor || "Equipo")}</strong>${chipEstado(e.estado)}</div>
        <div class="muted small">ID ${esc(e.id)} · Ingreso ${fecha(e.creado_en)}${e.tipo_mantenimiento ? " · " + esc(e.tipo_mantenimiento) : ""}</div>
      </a>`).join("")
      : `<p class="vacio">${data.length ? "No hay equipos que coincidan." : "No tienes equipos registrados."}</p>`;
  };
  pintar();
  $("#buscar").oninput = pintar;
}

async function fichaCliente(id) {
  cargando();
  const { data, error } = await sb.rpc("mis_equipos");
  if (error) { aviso(msgError(error), true); return; }
  const f = data.find((x) => x.id === id);
  vista(`<a href="#/equipos" class="volver">← Mis equipos</a>` +
    (f ? fichaLimitadaHTML(f) : `<p class="vacio">Este equipo no está asociado a tu cuenta.</p>`));
}

// Horus · Bobinado: registro de motores rebobinados (solo admin y operarios con permiso)
import {
  sb, H, $, esc, dato, aviso, msgError, vista, cargando, fecha, hoy, nf, descargarCSV,
  clientesEmpresa, esAdmin,
} from "./nucleo.js";

export const rutas = [
  { patron: /^#\/bobinado$/, modulo: "bobinado", acceso: "staff", render: () => lista() },
  { patron: /^#\/bobinado\/nuevo$/, modulo: "bobinado", acceso: "staff", render: () => formulario(null) },
  { patron: /^#\/bobinado\/([^/]+)\/editar$/, modulo: "bobinado", acceso: "staff", render: (id) => formulario(id) },
  { patron: /^#\/bobinado\/([^/]+)$/, modulo: "bobinado", acceso: "staff", render: (id) => ficha(id) },
];

const ESTADOS = ["Recibido", "En proceso", "Terminado", "Entregado"];
const claseEst = { Recibido: "pendiente", "En proceso": "proceso", Terminado: "listo", Entregado: "ok" };

// Campos del formulario. t: tipo (num = número, txt = texto), l: lista de sugerencias
const PLACA = [
  { k: "marca", n: "Marca" }, { k: "modelo", n: "Modelo / carcasa" }, { k: "serie", n: "N° de serie" },
  { k: "potencia", n: "Potencia", t: "num" }, { k: "rpm", n: "RPM", t: "int" },
  { k: "voltaje", n: "Voltaje (V)", ph: "380/660" }, { k: "corriente", n: "Corriente (A)", ph: "12,5/7,2" },
  { k: "frecuencia", n: "Frecuencia (Hz)", t: "int" },
];
const BOBINA = [
  { k: "ranuras", n: "N° de ranuras", t: "int" }, { k: "polos", n: "N° de polos", t: "int" },
  { k: "tipo_bobinado", n: "Tipo de bobinado", l: ["Concéntrico", "Imbricado", "Ondulado", "Por polos consecuentes"] },
  { k: "paso", n: "Paso", ph: "1-8-10-12" }, { k: "vueltas", n: "Vueltas por bobina", ph: "24" },
  { k: "calibre", n: "Calibre del alambre", ph: "AWG 18 / 1,02 mm" },
  { k: "alambres_paralelo", n: "Alambres en paralelo", t: "int" },
  { k: "conexion", n: "Conexión", l: ["Estrella", "Triángulo", "Estrella-Triángulo", "Doble estrella", "Dahlander"] },
  { k: "peso_cobre", n: "Peso del cobre (kg)", t: "num" },
];

const potenciaTxt = (b) => (b.potencia != null ? `${nf.format(b.potencia)} ${b.potencia_unidad}` : "");
const motorTxt = (b) => [b.marca, b.modelo].filter(Boolean).join(" ") || "Motor sin marca";

// ---------- Lista ----------
async function lista() {
  cargando();
  const clientes = await clientesEmpresa();
  vista(`
    <div class="acciones">
      <a class="btn primary" href="#/bobinado/nuevo">+ Nuevo bobinado</a>
      <button id="btn-csv">Exportar CSV</button>
    </div>
    <div class="panel filtros">
      <div><label for="b-txt">Buscar</label><input id="b-txt" type="search" placeholder="Marca, modelo, serie, cliente…"></div>
      <div><label for="b-cli">Cliente</label><select id="b-cli"><option value="">Todos</option>
        ${clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></div>
      <div><label for="b-est">Estado</label><select id="b-est"><option value="">Todos</option>
        ${ESTADOS.map((e) => `<option>${e}</option>`).join("")}</select></div>
    </div>
    <p class="muted small" id="conteo"></p>
    <div id="lista" class="lista"></div>`);

  const { data, error } = await sb.from("bobinados").select("*, clientes(nombre)")
    .eq("empresa_id", H.empresa.id).order("fecha", { ascending: false }).order("creado_en", { ascending: false }).limit(1000);
  if (error) { $("#lista").innerHTML = `<p class="vacio">${esc(msgError(error))}</p>`; return; }

  let vistos = [];
  const pintar = () => {
    const txt = $("#b-txt").value.trim().toLowerCase(), cli = $("#b-cli").value, est = $("#b-est").value;
    vistos = data.filter((b) => (!cli || b.cliente_id === cli) && (!est || b.estado === est) &&
      (!txt || [b.marca, b.modelo, b.serie, b.clientes?.nombre, b.observaciones].join(" ").toLowerCase().includes(txt)));
    $("#conteo").textContent = `${vistos.length} de ${data.length} bobinado${data.length === 1 ? "" : "s"}`;
    $("#lista").innerHTML = vistos.length ? vistos.map((b) => `
      <a class="tarjeta" href="#/bobinado/${b.id}">
        <div class="t-top"><strong>${esc(motorTxt(b))}</strong><span class="chip ${claseEst[b.estado] || "info"}">${esc(b.estado)}</span></div>
        <div>${esc(b.clientes?.nombre || "Sin cliente")}</div>
        <div class="muted small">${[fecha(b.fecha), potenciaTxt(b), b.rpm ? b.rpm + " RPM" : "", b.ranuras ? b.ranuras + " ranuras" : ""]
          .filter(Boolean).map(esc).join(" · ")}</div>
      </a>`).join("") : `<p class="vacio">${data.length ? "Ningún bobinado coincide con la búsqueda." : "Aún no hay bobinados registrados."}</p>`;
  };
  $("#b-txt").oninput = pintar;
  $("#b-cli").onchange = pintar;
  $("#b-est").onchange = pintar;
  $("#btn-csv").onclick = () => descargarCSV("bobinados",
    ["Fecha", "Estado", "Cliente", ...PLACA.map((c) => c.n), "Unidad potencia", "Fases", ...BOBINA.map((c) => c.n), "Observaciones"],
    vistos.map((b) => [b.fecha, b.estado, b.clientes?.nombre, ...PLACA.map((c) => b[c.k]), b.potencia_unidad, b.fases,
      ...BOBINA.map((c) => b[c.k]), b.observaciones]));
  pintar();
}

// ---------- Ficha ----------
async function ficha(id) {
  cargando();
  const { data: b, error } = await sb.from("bobinados").select("*, clientes(nombre)").eq("id", id).maybeSingle();
  if (error || !b) return vista(`<a href="#/bobinado" class="volver">← Bobinado</a><p class="vacio">${error ? esc(msgError(error)) : "No se encontró el bobinado."}</p>`);
  const fila = (n, v) => (v == null || v === "" ? "" : dato(n, esc(v)));
  const valor = (c) => (c.k === "potencia" ? potenciaTxt(b) : c.t === "num" && b[c.k] != null ? nf.format(b[c.k]) : b[c.k]);
  const v = vista(`
    <a href="#/bobinado" class="volver">← Bobinado</a>
    <div class="cabecera"><div><h1>${esc(motorTxt(b))}</h1>
      <p class="muted" style="margin:-8px 0 12px">${esc(b.clientes?.nombre || "Sin cliente")} · ${fecha(b.fecha)}</p></div>
      <span class="chip ${claseEst[b.estado] || "info"}">${esc(b.estado)}</span></div>
    <div class="fila-acciones">
      <a class="btn primary" href="#/bobinado/${b.id}/editar">Editar</a>
      ${esAdmin() ? `<button class="peligro" id="btn-borrar">Eliminar</button>` : ""}
    </div>
    <div class="panel"><h2>Datos de placa</h2><dl class="datos">
      ${PLACA.map((c) => fila(c.n, valor(c))).join("")}${fila("Fases", b.fases ? (b.fases === 1 ? "Monofásico" : "Trifásico") : "")}
    </dl></div>
    <div class="panel"><h2>Bobinado</h2><dl class="datos">${BOBINA.map((c) => fila(c.n, valor(c))).join("") || "<dd class='muted'>Sin datos</dd>"}</dl></div>
    ${b.observaciones ? `<div class="panel"><h2>Observaciones</h2><p style="margin:0;white-space:pre-wrap">${esc(b.observaciones)}</p></div>` : ""}`);
  const borrar = $("#btn-borrar", v);
  if (borrar) borrar.onclick = async () => {
    if (!confirm("¿Eliminar este bobinado? No se puede deshacer.")) return;
    const { error: e } = await sb.from("bobinados").delete().eq("id", b.id);
    if (e) return aviso(msgError(e), true);
    aviso("Bobinado eliminado.");
    location.hash = "#/bobinado";
  };
}

// ---------- Formulario ----------
async function formulario(id) {
  cargando();
  let b = { fecha: hoy(), estado: "Recibido", potencia_unidad: "kW", frecuencia: 50, fases: 3 };
  if (id) {
    const { data, error } = await sb.from("bobinados").select("*").eq("id", id).maybeSingle();
    if (error || !data) return vista(`<a href="#/bobinado" class="volver">← Bobinado</a><p class="vacio">No se encontró el bobinado.</p>`);
    b = data;
  }
  const clientes = await clientesEmpresa();
  const input = (c) => {
    const val = b[c.k] ?? "";
    const tipo = c.t ? `inputmode="${c.t === "int" ? "numeric" : "decimal"}"` : "";
    const lista = c.l ? `list="l-${c.k}"` : "";
    return `<div><label for="f-${c.k}">${c.n}</label>
      ${c.k === "potencia" ? `<div style="display:flex;gap:6px"><input id="f-potencia" ${tipo} value="${esc(val)}">
        <select id="f-potencia_unidad" style="width:auto">${["kW", "HP"].map((u) => `<option${u === b.potencia_unidad ? " selected" : ""}>${u}</option>`).join("")}</select></div>`
        : `<input id="f-${c.k}" ${tipo} ${lista} value="${esc(val)}" placeholder="${esc(c.ph || "")}" autocomplete="off">`}
      ${c.l ? `<datalist id="l-${c.k}">${c.l.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}</div>`;
  };
  const v = vista(`
    <a href="${id ? "#/bobinado/" + id : "#/bobinado"}" class="volver">← ${id ? "Volver a la ficha" : "Bobinado"}</a>
    <h1>${id ? "Editar bobinado" : "Nuevo bobinado"}</h1>
    <form id="form-bob" novalidate>
      <div class="panel"><h2>General</h2><div class="grid2">
        <div><label for="f-cliente">Cliente</label><select id="f-cliente"><option value="">— Sin cliente —</option>
          ${clientes.map((c) => `<option value="${c.id}"${c.id === b.cliente_id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></div>
        <div><label for="f-fecha" class="req">Fecha</label><input id="f-fecha" type="date" value="${esc(b.fecha)}"></div>
        <div><label for="f-estado">Estado</label><select id="f-estado">${ESTADOS.map((e) => `<option${e === b.estado ? " selected" : ""}>${e}</option>`).join("")}</select></div>
        <div><label for="f-fases">Fases</label><select id="f-fases">
          <option value="3"${b.fases === 3 ? " selected" : ""}>Trifásico</option><option value="1"${b.fases === 1 ? " selected" : ""}>Monofásico</option></select></div>
      </div></div>
      <div class="panel"><h2>Datos de placa</h2><div class="grid2">${PLACA.map(input).join("")}</div></div>
      <div class="panel"><h2>Bobinado</h2><div class="grid2">${BOBINA.map(input).join("")}</div>
        <label for="f-obs">Observaciones</label><textarea id="f-obs">${esc(b.observaciones || "")}</textarea></div>
      <div class="guardar"><a class="btn" href="${id ? "#/bobinado/" + id : "#/bobinado"}">Cancelar</a>
        <button class="primary" type="submit" id="btn-guardar">${id ? "Guardar cambios" : "Guardar bobinado"}</button></div>
    </form>`);

  $("#form-bob", v).onsubmit = async (ev) => {
    ev.preventDefault();
    if (!$("#f-fecha").value) return aviso("Indica la fecha.", true);
    const fila = {
      cliente_id: $("#f-cliente").value || null, fecha: $("#f-fecha").value, estado: $("#f-estado").value,
      fases: Number($("#f-fases").value), potencia_unidad: $("#f-potencia_unidad").value,
      observaciones: $("#f-obs").value.trim() || null,
    };
    for (const c of [...PLACA, ...BOBINA]) {
      const raw = $("#f-" + c.k).value.trim();
      if (!c.t) { fila[c.k] = raw || null; continue; }
      if (!raw) { fila[c.k] = null; continue; }
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || (c.t === "int" && !Number.isInteger(n))) {
        $("#f-" + c.k).focus();
        return aviso(`"${c.n}" debe ser un número${c.t === "int" ? " entero" : ""}.`, true);
      }
      fila[c.k] = n;
    }
    if (!fila.marca && !fila.modelo && !fila.cliente_id) return aviso("Indica al menos el cliente, la marca o el modelo.", true);
    const btn = $("#btn-guardar");
    btn.disabled = true;
    const r = id
      ? await sb.from("bobinados").update(fila).eq("id", id).select("id").single()
      : await sb.from("bobinados").insert({ ...fila, empresa_id: H.empresa.id }).select("id").single();
    if (r.error) { btn.disabled = false; return aviso("Error al guardar: " + msgError(r.error), true); }
    aviso(id ? "Cambios guardados." : "Bobinado registrado.");
    location.hash = "#/bobinado/" + r.data.id;
  };
}

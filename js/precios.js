// Horus · Lista de precios: solo lectura para todos. El admin carga una lista por mes desde Excel.
import { sb, H, $, $$, esc, aviso, msgError, vista, cargando, nf, esAdmin, descargarCSV } from "./nucleo.js";
import { leerArchivo, separarEncabezado, aNumero, normal, mesDeNombre } from "./excel.js";

export const rutas = [
  { patron: /^#\/precios$/, modulo: "precios", acceso: "staff", render: () => lista() },
];

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (periodo) => `${MESES[+periodo.slice(5, 7) - 1]} ${periodo.slice(0, 4)}`;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const precioTxt = (n) => (n == null ? "—" : pesos.format(n));
const POR_PAGINA = 100;

async function lista() {
  cargando();
  const { data: listas, error } = await sb.from("listas_precios").select("*")
    .eq("empresa_id", H.empresa.id).order("periodo", { ascending: false });
  if (error) return vista(`<p class="vacio">${esc(msgError(error))}</p>`);

  const v = vista(`
    <div class="cabecera"><h1>Lista de precios</h1>
      ${esAdmin() ? `<button class="primary" id="btn-cargar">+ Cargar lista del mes</button>` : ""}</div>
    ${listas.length ? `
    <div class="panel filtros">
      <div><label for="p-lista">Lista</label><select id="p-lista">
        ${listas.map((l, i) => `<option value="${l.id}">${esc(nombreMes(l.periodo))}${i === 0 ? " (vigente)" : ""}</option>`).join("")}</select></div>
      <div style="grid-column:span 2"><label for="p-txt">Buscar producto</label>
        <input id="p-txt" type="search" placeholder="Código o descripción. Ej.: bomba pedrollo 4sr" autocomplete="off"></div>
      <div><label for="p-tipo">Tipo</label><select id="p-tipo"></select></div>
      <div><label for="p-orden">Ordenar</label><select id="p-orden">
        <option value="descripcion">Descripción (A-Z)</option><option value="precio_asc">Precio: menor a mayor</option>
        <option value="precio_desc">Precio: mayor a menor</option></select></div>
    </div>
    <div class="acciones"><span class="muted small" id="p-info" style="flex:1 1 240px"></span>
      <button class="chico" id="p-csv">Exportar resultado</button>
      ${esAdmin() ? `<button class="chico peligro" id="p-borrar">Eliminar esta lista</button>` : ""}</div>
    <div id="p-res"></div>` : `<p class="vacio">Todavía no hay listas de precios cargadas.${esAdmin() ? " Usa “Cargar lista del mes”." : ""}</p>`}
    ${esAdmin() ? dialogoCarga() : ""}`, true);

  if (esAdmin()) prepararCarga(v);
  if (!listas.length) return;

  let pagina = 0, ultimo = [], pedido = 0;
  const actual = () => listas.find((l) => l.id === $("#p-lista").value);
  const llenarTipos = () => {
    const l = actual();
    $("#p-tipo").innerHTML = `<option value="">Todos</option>` + l.tipos.map((t) => `<option>${esc(t)}</option>`).join("");
    const anterior = listas[listas.indexOf(l) + 1];
    $("#p-info").textContent = `${nf.format(l.total)} productos · cargada el ${new Date(l.cargado_en).toLocaleDateString("es-CL")}` +
      (anterior ? ` · se compara con ${nombreMes(anterior.periodo)}` : "");
  };

  async function buscar(mas = false) {
    const n = ++pedido;
    pagina = mas ? pagina + 1 : 0;
    if (!mas) $("#p-res").innerHTML = `<p class="vacio">Buscando…</p>`;
    const { data, error: e } = await sb.rpc("buscar_precios", {
      p_lista: $("#p-lista").value, p_texto: $("#p-txt").value, p_tipo: $("#p-tipo").value || null,
      p_orden: $("#p-orden").value, p_limite: POR_PAGINA, p_desde: pagina * POR_PAGINA,
    });
    if (n !== pedido) return; // llegó una búsqueda más nueva
    if (e) { $("#p-res").innerHTML = `<p class="vacio">${esc(msgError(e))}</p>`; return; }
    ultimo = mas ? ultimo.concat(data) : data;
    const total = Number(data[0]?.total ?? (mas ? ultimo[0]?.total : 0) ?? 0);
    pintar(total);
  }

  function variacion(p) {
    if (p.precio == null || p.precio_anterior == null || +p.precio_anterior === 0) return "";
    const d = ((p.precio - p.precio_anterior) / p.precio_anterior) * 100;
    if (Math.abs(d) < 0.05) return `<span class="muted small">=</span>`;
    return `<span class="chip ${d > 0 ? "mal" : "ok"}" title="Antes: ${esc(precioTxt(+p.precio_anterior))}">${d > 0 ? "▲" : "▼"} ${nf.format(Math.abs(Math.round(d * 10) / 10))}%</span>`;
  }

  function pintar(total) {
    $("#p-res").innerHTML = ultimo.length ? `
      <p class="muted small">${nf.format(total)} producto${total === 1 ? "" : "s"} encontrados${total > ultimo.length ? ` · mostrando ${nf.format(ultimo.length)}` : ""}</p>
      <div class="tabla-wrap"><table class="tabla tabla-precios">
        <thead><tr><th>Código</th><th>Descripción</th><th>Tipo</th><th>Unidad</th><th class="num">Precio neto</th><th class="num">Var.</th></tr></thead>
        <tbody>${ultimo.map((p) => `<tr>
          <td class="cod">${esc(p.codigo)}</td><td class="desc">${esc(p.descripcion)}</td><td class="tipo muted small">${esc(p.tipo)}</td>
          <td class="um">${esc(p.unidad)}</td><td class="num pre"><strong>${precioTxt(p.precio == null ? null : +p.precio)}</strong></td>
          <td class="num var">${variacion(p)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${total > ultimo.length ? `<div class="acciones" style="justify-content:center;margin-top:10px"><button id="p-mas">Mostrar más</button></div>` : ""}`
      : `<p class="vacio">No se encontraron productos.</p>`;
    const mas = $("#p-mas");
    if (mas) mas.onclick = () => { mas.disabled = true; buscar(true); };
  }

  let t;
  $("#p-txt").oninput = () => { clearTimeout(t); t = setTimeout(() => buscar(), 250); };
  $("#p-tipo").onchange = () => buscar();
  $("#p-orden").onchange = () => buscar();
  $("#p-lista").onchange = () => { llenarTipos(); buscar(); };
  $("#p-csv").onclick = async () => {
    // exporta todo lo que coincide (hasta 5.000 filas), no solo lo que está en pantalla
    const filas = [];
    for (let desde = 0; desde < 5000; desde += 500) {
      const { data, error: e } = await sb.rpc("buscar_precios", {
        p_lista: $("#p-lista").value, p_texto: $("#p-txt").value, p_tipo: $("#p-tipo").value || null,
        p_orden: $("#p-orden").value, p_limite: 500, p_desde: desde,
      });
      if (e) return aviso(msgError(e), true);
      filas.push(...data);
      if (data.length < 500) break;
    }
    descargarCSV("lista-precios-" + actual().periodo.slice(0, 7), ["Código", "Tipo", "Descripción", "Unidad", "Precio neto", "Precio anterior"],
      filas.map((p) => [p.codigo, p.tipo, p.descripcion, p.unidad, p.precio == null ? null : +p.precio, p.precio_anterior == null ? null : +p.precio_anterior]));
  };
  const borrar = $("#p-borrar");
  if (borrar) borrar.onclick = async () => {
    const l = actual();
    if (!confirm(`¿Eliminar la lista de ${nombreMes(l.periodo)} (${nf.format(l.total)} productos)? No se puede deshacer.`)) return;
    const { error: e } = await sb.from("listas_precios").delete().eq("id", l.id);
    if (e) return aviso(msgError(e), true);
    aviso("Lista eliminada.");
    lista();
  };
  llenarTipos();
  buscar();
}

// ---------- Carga desde Excel (solo admin) ----------
function dialogoCarga() {
  return `<dialog id="dlg-lp"><form id="form-lp" method="dialog" novalidate>
    <h2>Cargar lista de precios</h2>
    <label for="lp-archivo" class="req">Archivo Excel</label><input id="lp-archivo" type="file" accept=".xlsx,.xls,.xlsm,.csv">
    <div id="lp-detalle" class="muted small" style="margin-top:6px"></div>
    <div class="grid2">
      <div><label for="lp-mes" class="req">Mes</label><input id="lp-mes" type="month"></div>
      <div><label for="lp-nombre">Nombre</label><input id="lp-nombre" placeholder="LP noviembre 2026"></div>
    </div>
    <p class="muted small">Una vez cargada, nadie puede modificar los precios. Si hay un error, elimina la lista y vuelve a cargarla.</p>
    <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit" id="lp-ok" disabled>Cargar</button></div>
  </form></dialog>`;
}

// Reconoce las columnas por su nombre (ID, Tipo, Descripción, UMStock, PrecioNeto, o parecidas)
const CAMPOS = {
  codigo: /^(id|cod|codigo|sku|item|articulo|n°|nro)\b/,
  tipo: /^(tipo|familia|categoria|linea|grupo)/,
  descripcion: /(descrip|producto|nombre|detalle|glosa)/,
  unidad: /^(um|u\.m|unidad|umstock|medida)/,
  precio: /(precio|valor|neto|p\.? ?unit)/,
};
function extraerProductos(hojas) {
  // hoja "Productos" si existe; si no, la que tenga más filas
  const hoja = hojas.find((h) => normal(h.nombre) === "productos") || hojas.reduce((a, h) => (h.filas.length > a.filas.length ? h : a));
  const { columnas, datos } = separarEncabezado(hoja.filas);
  const idx = {};
  const libres = columnas.map((c) => normal(c));
  for (const [campo, re] of Object.entries(CAMPOS)) {
    const i = libres.findIndex((c, j) => re.test(c) && !Object.values(idx).includes(j));
    if (i >= 0) idx[campo] = i;
  }
  if (idx.descripcion == null) throw new Error("No encontré la columna de descripción.");
  if (idx.precio == null) throw new Error("No encontré la columna de precio.");
  const items = datos.map((f) => ({
    codigo: idx.codigo != null && f[idx.codigo] != null ? String(f[idx.codigo]).trim() : null,
    tipo: idx.tipo != null && f[idx.tipo] != null ? String(f[idx.tipo]).trim() : null,
    descripcion: f[idx.descripcion] != null ? String(f[idx.descripcion]).trim() : "",
    unidad: idx.unidad != null && f[idx.unidad] != null ? String(f[idx.unidad]).trim() : null,
    precio: aNumero(f[idx.precio]),
  })).filter((p) => p.descripcion);
  return { hoja: hoja.nombre, columnas: Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, columnas[i]])), items };
}

function prepararCarga(v) {
  const dlg = $("#dlg-lp", v);
  let leido = null, archivo = "";
  $("#btn-cargar", v).onclick = () => { $("#form-lp").reset(); $("#lp-detalle").textContent = ""; $("#lp-ok").disabled = true; leido = null; dlg.showModal(); };
  $("[data-cerrar]", dlg).onclick = () => dlg.close();
  $("#lp-archivo").onchange = async (ev) => {
    const f = ev.target.files[0];
    leido = null; $("#lp-ok").disabled = true;
    if (!f) return;
    $("#lp-detalle").textContent = "Leyendo…";
    try {
      leido = extraerProductos(await leerArchivo(f));
      archivo = f.name;
      const sinPrecio = leido.items.filter((p) => p.precio == null).length;
      $("#lp-detalle").innerHTML = `✔ <b>${nf.format(leido.items.length)} productos</b> en la hoja “${esc(leido.hoja)}”.<br>
        Columnas: ${Object.entries(leido.columnas).map(([k, c]) => `${k} = “${esc(c)}”`).join(", ")}
        ${sinPrecio ? `<br>⚠ ${nf.format(sinPrecio)} productos sin precio.` : ""}`;
      const mes = mesDeNombre(f.name);
      if (mes && !$("#lp-mes").value) $("#lp-mes").value = mes;
      if (!$("#lp-nombre").value) $("#lp-nombre").value = f.name.replace(/\.[^.]+$/, "");
      $("#lp-ok").disabled = !leido.items.length;
    } catch (e) {
      $("#lp-detalle").textContent = "⚠ " + e.message;
    }
  };
  $("#form-lp").onsubmit = async (ev) => {
    ev.preventDefault();
    if (!leido) return aviso("Elige el archivo.", true);
    const mes = $("#lp-mes").value;
    if (!mes) return aviso("Indica el mes de la lista.", true);
    const btn = $("#lp-ok");
    btn.disabled = true; btn.textContent = "Cargando…";
    const { error } = await sb.rpc("cargar_lista_precios", {
      p_empresa: H.empresa.id, p_periodo: mes + "-01", p_nombre: $("#lp-nombre").value.trim(), p_archivo: archivo, p_items: leido.items,
    });
    btn.textContent = "Cargar"; btn.disabled = false;
    if (error) return aviso(msgError(error), true);
    dlg.close();
    aviso(`Lista cargada: ${nf.format(leido.items.length)} productos.`);
    lista();
  };
}

// Horus · Inventario: productos, entradas/salidas, escaneo de códigos
import {
  sb, H, $, esc, aviso, msgError, vista, cargando, alSalirDeVista, fmtHora, nf, descargarCSV,
  esAdmin, abrirLector, cerrarLector,
} from "./nucleo.js";

export const rutas = [
  { patron: /^#\/inventario$/, modulo: "inventario", acceso: "staff", render: () => pantalla("productos") },
  { patron: /^#\/inventario\/movimientos$/, modulo: "inventario", acceso: "staff", render: () => pantalla("movimientos") },
];

let productos = [];
let movimientos = [];
const esBajo = (p) => Number(p.stock_minimo) > 0 && Number(p.stock) <= Number(p.stock_minimo);

async function cargar() {
  const emp = H.empresa.id;
  const [p, m] = await Promise.all([
    sb.from("productos").select("*").eq("empresa_id", emp).order("nombre"),
    sb.from("movimientos").select("*, productos!inner(nombre, codigo, unidad, empresa_id)")
      .eq("productos.empresa_id", emp).order("creado_en", { ascending: false }).limit(300),
  ]);
  if (p.error || m.error) { aviso(msgError(p.error || m.error), true); return false; }
  productos = p.data;
  movimientos = m.data;
  return true;
}

async function pantalla(pestana) {
  cargando();
  if (!(await cargar())) return;
  const v = vista(`
    <div class="pestanas">
      <a href="#/inventario" class="${pestana === "productos" ? "on" : ""}">Productos</a>
      <a href="#/inventario/movimientos" class="${pestana === "movimientos" ? "on" : ""}">Movimientos</a>
    </div>
    <div id="cuerpo"></div>

    <dialog id="dlg-mov"><form id="form-mov" method="dialog">
      <h2 id="m-titulo"></h2><p class="muted small" id="m-sub"></p>
      <div class="radios">
        <label><input type="radio" name="tipo" value="salida" id="t-sal"> − Salida</label>
        <label><input type="radio" name="tipo" value="entrada" id="t-ent"> + Entrada</label>
      </div>
      <label for="m-cant" class="req">Cantidad</label>
      <input id="m-cant" type="number" inputmode="decimal" step="any" min="0" required>
      <label for="m-motivo">Motivo (opcional)</label>
      <input id="m-motivo" placeholder="Ej.: obra calle Prat, compra, ajuste…">
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button type="submit" class="primary">Guardar</button></div>
    </form></dialog>

    <dialog id="dlg-prod"><form id="form-prod" method="dialog">
      <h2 id="p-titulo"></h2>
      <label for="p-codigo" class="req">Código (texto del QR o código de barras)</label><input id="p-codigo" required>
      <label for="p-nombre" class="req">Nombre</label><input id="p-nombre" required>
      <div class="grid2">
        <div><label for="p-cat">Categoría</label><input id="p-cat" list="dl-cats"><datalist id="dl-cats"></datalist></div>
        <div><label for="p-ubic">Ubicación</label><input id="p-ubic" placeholder="Estante, bodega…"></div>
        <div><label for="p-unidad">Unidad</label><input id="p-unidad" placeholder="un, m, kg…"></div>
        <div><label for="p-min">Stock mínimo (alerta)</label><input id="p-min" type="number" step="any" min="0"></div>
      </div>
      <div id="p-stock-wrap"><label for="p-stock">Stock inicial</label><input id="p-stock" type="number" step="any" min="0"></div>
      <p class="muted small" id="p-nota-stock">El stock solo cambia con entradas y salidas, para que quede historial.</p>
      <div class="pie">
        <button type="button" class="peligro" id="p-eliminar" hidden>Eliminar</button>
        <button type="button" id="p-baja" hidden>Dar de baja</button>
        <button type="button" data-cerrar>Cancelar</button><button type="submit" class="primary">Guardar</button>
      </div>
    </form></dialog>

    <dialog id="dlg-scan"><h2>Escanear código</h2><div id="lector"></div>
      <p class="muted small" id="scan-msg">Apunta la cámara al QR o código de barras.</p>
      <div class="pie"><button type="button" data-cerrar>Cerrar</button></div></dialog>`, true);

  v.querySelectorAll("[data-cerrar]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  $("#dlg-scan").addEventListener("close", cerrarLector);
  $("#form-mov").onsubmit = guardarMovimiento;
  $("#form-prod").onsubmit = guardarProducto;
  $("#p-baja").onclick = darDeBaja;
  $("#p-eliminar").onclick = eliminarProducto;

  const pintar = pestana === "productos" ? pintarProductos : pintarMovimientos;
  pintar();
  let t;
  const canal = sb.channel("inventario")
    .on("postgres_changes", { event: "*", schema: "public", table: "productos" }, recargar)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "movimientos" }, recargar)
    .subscribe();
  function recargar() {
    clearTimeout(t);
    t = setTimeout(async () => { if (await cargar()) actualizar(); }, 300);
  }
  alSalirDeVista(() => { clearTimeout(t); sb.removeChannel(canal); cerrarLector(); });
}
let actualizar = () => {};

// ---------- Productos ----------
function pintarProductos() {
  $("#cuerpo").innerHTML = `
    <div class="acciones">
      <button id="btn-scan" class="primary">Escanear</button>
      <button id="btn-nuevo">+ Nuevo producto</button>
      <button id="btn-csv">Exportar CSV</button>
    </div>
    <div class="filtros">
      <input id="buscar" type="search" placeholder="Buscar por nombre, código o ubicación…" aria-label="Buscar">
      <select id="f-cat" aria-label="Categoría"></select>
      <div class="checks"><label><input type="checkbox" id="solo-bajo"> Solo stock bajo</label>
        <label><input type="checkbox" id="ver-baja"> Ver dados de baja</label></div>
    </div>
    <p class="muted small" id="resumen"></p>
    <div class="productos" id="lista"></div>`;
  const filtrar = () => {
    const cats = [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort();
    const sel = $("#f-cat"), actual = sel.value;
    sel.innerHTML = `<option value="">Todas las categorías</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
    sel.value = cats.includes(actual) ? actual : "";
    $("#dl-cats").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
    const q = $("#buscar").value.trim().toLowerCase(), bajo = $("#solo-bajo").checked, baja = $("#ver-baja").checked;
    const activos = productos.filter((p) => p.activo);
    const l = productos.filter((p) => (baja ? !p.activo : p.activo) &&
      (!q || [p.nombre, p.codigo, p.ubicacion, p.categoria].some((x) => (x || "").toLowerCase().includes(q))) &&
      (!bajo || esBajo(p)) && (!sel.value || p.categoria === sel.value));
    const nBajo = activos.filter(esBajo).length;
    $("#resumen").textContent = `${activos.length} productos` + (nBajo ? ` · ${nBajo} con stock bajo` : "");
    $("#lista").innerHTML = l.length ? l.map(tarjeta).join("")
      : `<p class="vacio" style="grid-column:1/-1">${activos.length || baja ? "Sin resultados." : "Aún no hay productos. Crea el primero con “+ Nuevo producto”."}</p>`;
  };
  actualizar = filtrar;
  filtrar();
  ["#buscar", "#f-cat", "#solo-bajo", "#ver-baja"].forEach((s) => $(s).addEventListener("input", filtrar));
  $("#btn-nuevo").onclick = () => abrirProducto(null);
  $("#btn-scan").onclick = abrirScan;
  $("#btn-csv").onclick = () => descargarCSV("inventario",
    ["Código", "Nombre", "Categoría", "Ubicación", "Stock", "Unidad", "Stock mínimo", "Activo"],
    productos.map((p) => [p.codigo, p.nombre, p.categoria, p.ubicacion, Number(p.stock), p.unidad, Number(p.stock_minimo), p.activo ? "Sí" : "No"]));
  $("#lista").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.mov) abrirMov(b.dataset.mov, b.dataset.tipo);
    if (b.dataset.edit) abrirProducto(b.dataset.edit);
    if (b.dataset.reactivar) reactivar(b.dataset.reactivar);
  };
}

function tarjeta(p) {
  return `<article class="producto ${esBajo(p) && p.activo ? "bajo" : ""}">
    <div><h3>${esc(p.nombre)}</h3>
      <div class="muted small">${esc(p.codigo)}${p.ubicacion ? " · " + esc(p.ubicacion) : ""}${p.categoria ? " · " + esc(p.categoria) : ""}</div></div>
    <div class="t-top"><div class="stock">${nf.format(p.stock)} <small>${esc(p.unidad)}</small></div>
      ${esBajo(p) ? `<span class="chip warn">Stock bajo (mín. ${nf.format(p.stock_minimo)})</span>` : ""}</div>
    <div class="acciones">${p.activo ? `
      <button data-mov="${p.id}" data-tipo="entrada" class="in chico">+ Entrada</button>
      <button data-mov="${p.id}" data-tipo="salida" class="out chico">− Salida</button>
      <button data-edit="${p.id}" class="ghost chico">Editar</button>`
      : `<button data-reactivar="${p.id}" class="chico">Reactivar</button><button data-edit="${p.id}" class="ghost chico">Editar</button>`}
    </div></article>`;
}

function abrirMov(id, tipo = "salida") {
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  $("#form-mov").dataset.id = id;
  $("#m-titulo").textContent = p.nombre;
  $("#m-sub").textContent = `${p.codigo} · Stock actual: ${nf.format(p.stock)} ${p.unidad}`;
  $(tipo === "entrada" ? "#t-ent" : "#t-sal").checked = true;
  $("#m-cant").value = "";
  $("#m-motivo").value = "";
  $("#dlg-mov").showModal();
  $("#m-cant").focus();
}

async function guardarMovimiento(ev) {
  ev.preventDefault();
  const f = ev.target;
  const cantidad = parseFloat($("#m-cant").value);
  if (!(cantidad > 0)) return aviso("Ingresa una cantidad mayor que 0.", true);
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  const { error } = await sb.from("movimientos").insert({
    producto_id: f.dataset.id,
    tipo: f.querySelector("input[name=tipo]:checked").value,
    cantidad,
    motivo: $("#m-motivo").value.trim() || null,
  });
  btn.disabled = false;
  if (error) return aviso(msgError(error), true);
  $("#dlg-mov").close();
  aviso("Movimiento registrado.");
  if (await cargar()) actualizar();
}

let editandoId = null;
function abrirProducto(id, codigoNuevo = "") {
  editandoId = id || null;
  const p = id ? productos.find((x) => x.id === id) : null;
  $("#p-titulo").textContent = p ? "Editar producto" : "Nuevo producto";
  $("#p-codigo").value = p ? p.codigo : codigoNuevo;
  $("#p-nombre").value = p ? p.nombre : "";
  $("#p-cat").value = p?.categoria || "";
  $("#p-ubic").value = p?.ubicacion || "";
  $("#p-unidad").value = p ? p.unidad : "un";
  $("#p-min").value = p ? p.stock_minimo : 0;
  $("#p-stock").value = 0;
  $("#p-stock-wrap").hidden = !!p;
  $("#p-nota-stock").hidden = !p;
  $("#p-baja").hidden = !p || !p.activo;
  $("#p-eliminar").hidden = !p || !esAdmin();
  $("#dlg-prod").showModal();
  (p || codigoNuevo ? $("#p-nombre") : $("#p-codigo")).focus();
}

async function guardarProducto(ev) {
  ev.preventDefault();
  const datos = {
    codigo: $("#p-codigo").value.trim(),
    nombre: $("#p-nombre").value.trim(),
    categoria: $("#p-cat").value.trim() || null,
    ubicacion: $("#p-ubic").value.trim() || null,
    unidad: $("#p-unidad").value.trim() || "un",
    stock_minimo: parseFloat($("#p-min").value) || 0,
  };
  if (!datos.codigo || !datos.nombre) return aviso("Faltan el código o el nombre.", true);
  const btn = ev.target.querySelector("[type=submit]");
  btn.disabled = true;
  let error;
  if (editandoId) ({ error } = await sb.from("productos").update(datos).eq("id", editandoId));
  else ({ error } = await sb.from("productos").insert({ ...datos, empresa_id: H.empresa.id, stock: parseFloat($("#p-stock").value) || 0 }));
  btn.disabled = false;
  if (error) return aviso(msgError(error), true);
  $("#dlg-prod").close();
  aviso("Producto guardado.");
  if (await cargar()) actualizar();
}

async function darDeBaja() {
  const p = productos.find((x) => x.id === editandoId);
  if (!p || !confirm(`¿Dar de baja "${p.nombre}"? Dejará de aparecer en la lista (el historial se conserva y se puede reactivar).`)) return;
  const { error } = await sb.from("productos").update({ activo: false }).eq("id", p.id);
  if (error) return aviso(msgError(error), true);
  $("#dlg-prod").close();
  aviso("Producto dado de baja.");
  if (await cargar()) actualizar();
}

async function reactivar(id) {
  const { error } = await sb.from("productos").update({ activo: true }).eq("id", id);
  if (error) return aviso(msgError(error), true);
  aviso("Producto reactivado.");
  if (await cargar()) actualizar();
}

async function eliminarProducto() {
  const p = productos.find((x) => x.id === editandoId);
  if (!p || !confirm(`¿ELIMINAR "${p.nombre}" y todo su historial de movimientos? No se puede deshacer.\n\nSi solo quieres ocultarlo, usa "Dar de baja".`)) return;
  const { error } = await sb.from("productos").delete().eq("id", p.id);
  if (error) return aviso(msgError(error), true);
  $("#dlg-prod").close();
  aviso("Producto eliminado.");
  if (await cargar()) actualizar();
}

async function abrirScan() {
  $("#scan-msg").textContent = "Apunta la cámara al QR o código de barras.";
  $("#dlg-scan").showModal();
  try {
    await abrirLector("lector", (texto) => {
      $("#dlg-scan").close();
      const codigo = texto.trim();
      const p = productos.find((x) => x.codigo.toLowerCase() === codigo.toLowerCase());
      if (p && p.activo) abrirMov(p.id, "salida");
      else if (p) aviso(`"${p.nombre}" está dado de baja. Reactívalo para usarlo.`, true);
      else { aviso("Código nuevo: completa los datos del producto."); abrirProducto(null, codigo); }
    });
  } catch {
    $("#scan-msg").textContent = "No se pudo abrir la cámara (requiere HTTPS y permiso del navegador). Puedes escribir el código en la búsqueda.";
  }
}

// ---------- Movimientos ----------
function pintarMovimientos() {
  $("#cuerpo").innerHTML = `
    <div class="acciones"><input id="buscar" type="search" placeholder="Buscar producto, motivo o usuario…" style="max-width:360px">
      <button id="btn-csv">Exportar CSV</button></div>
    <p class="muted small">Últimos 300 movimientos. El historial no se puede borrar ni editar.</p>
    <div class="tabla-wrap"><table class="tabla">
      <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="num">Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead>
      <tbody id="tabla-mov"></tbody></table></div>`;
  const filtrar = () => {
    const q = $("#buscar").value.trim().toLowerCase();
    const l = movimientos.filter((m) => !q || [m.productos?.nombre, m.productos?.codigo, m.motivo, m.usuario].some((x) => (x || "").toLowerCase().includes(q)));
    $("#tabla-mov").innerHTML = l.length ? l.map((m) => `<tr>
      <td>${esc(fmtHora(m.creado_en))}</td>
      <td>${esc(m.productos?.nombre || "—")}<div class="muted small">${esc(m.productos?.codigo || "")}</div></td>
      <td class="${m.tipo === "entrada" ? "in" : "out"}">${m.tipo === "entrada" ? "Entrada" : "Salida"}</td>
      <td class="num">${m.tipo === "entrada" ? "+" : "−"}${nf.format(m.cantidad)} ${esc(m.productos?.unidad || "")}</td>
      <td>${esc(m.motivo || "")}</td>
      <td class="muted small">${esc((m.usuario || "").split("@")[0])}</td></tr>`).join("")
      : `<tr><td colspan="6" class="vacio">Sin movimientos.</td></tr>`;
  };
  actualizar = filtrar;
  filtrar();
  $("#buscar").oninput = filtrar;
  $("#btn-csv").onclick = () => descargarCSV("movimientos",
    ["Fecha", "Código", "Producto", "Tipo", "Cantidad", "Unidad", "Motivo", "Usuario"],
    movimientos.map((m) => [fmtHora(m.creado_en), m.productos?.codigo, m.productos?.nombre, m.tipo, Number(m.cantidad), m.productos?.unidad, m.motivo, m.usuario]));
}

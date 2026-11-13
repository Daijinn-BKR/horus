// Horus · Proyectos pendientes (solo jefe eléctrico y administrador): qué hay que hacer, dónde,
// para cuándo y la lista de materiales con precio, con el monto total calculado.
import {
  sb, H, $, $$, esc, aviso, msgError, msgCarga, dato, vista, cargando, fecha, fmtHora, hoy, nf, descargarCSV,
  clientesEmpresa, esAdmin,
} from "./nucleo.js";

// Solo jefe eléctrico y admin (lo revisa el router)
export const rutas = [
  { patron: /^#\/pendientes$/, modulo: "pendientes", acceso: "jefe", render: () => lista() },
  { patron: /^#\/pendientes\/nuevo$/, modulo: "pendientes", acceso: "jefe", render: () => formulario(null) },
  { patron: /^#\/pendientes\/([^/]+)\/editar$/, modulo: "pendientes", acceso: "jefe", render: (id) => formulario(id) },
  { patron: /^#\/pendientes\/([^/]+)$/, modulo: "pendientes", acceso: "jefe", render: (id) => ficha(id) },
];

const ESTADOS = ["Pendiente", "En curso", "Terminado", "Cancelado"];
const CLASE = { Pendiente: "pendiente", "En curso": "proceso", Terminado: "listo", Cancelado: "" };
const chip = (e) => `<span class="chip ${CLASE[e] ?? ""}">${esc(e)}</span>`;
const abierto = (p) => p.estado === "Pendiente" || p.estado === "En curso";
const atrasado = (p) => abierto(p) && p.fecha_estimada && p.fecha_estimada < hoy();
const IVA = 0.19;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const clp = (n) => pesos.format(Math.round(Number(n) || 0));
const redondeo = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Neto (suma de subtotales), IVA y total del proyecto
function montos(materiales, agregarIva) {
  const neto = redondeo(materiales.reduce((s, m) => s + (m.subtotal != null ? Number(m.subtotal) : (Number(m.cantidad) || 0) * (Number(m.precio) || 0)), 0));
  const iva = agregarIva ? Math.round(neto * IVA) : 0;
  return { neto, iva, total: neto + iva };
}

// ---------- Lista ----------
async function lista() {
  cargando();
  vista(`
    <div class="cabecera"><h1>Proyectos pendientes</h1><a class="btn primary" href="#/pendientes/nuevo">+ Nuevo proyecto</a></div>
    <div class="filtros">
      <input id="p-buscar" type="search" placeholder="Buscar por proyecto, lugar o cliente…" aria-label="Buscar">
      <select id="p-estado" aria-label="Mostrar">
        <option value="abiertos">Pendientes y en curso</option>
        ${ESTADOS.map((e) => `<option>${e}</option>`).join("")}
        <option value="">Todos</option>
      </select>
      <button id="p-csv">Exportar CSV</button>
    </div>
    <p id="p-conteo" class="muted small"></p>
    <div id="p-lista" class="lista"></div>`);
  const { data, error } = await sb.from("proyectos_pendientes")
    .select("*, clientes(nombre), proyecto_materiales(subtotal)")
    .eq("empresa_id", H.empresa.id).order("fecha_estimada", { ascending: true, nullsFirst: false }).order("creado_en");
  if (!$("#p-lista")) return; // el usuario cambió de pantalla mientras cargaba
  if (error) {
    $("#p-lista").innerHTML = `<p class="vacio">${esc(msgCarga(error, "proyectos_pendientes"))}</p>`;
    return;
  }
  const total = (p) => montos(p.proyecto_materiales, p.agregar_iva).total;
  const pintar = () => {
    const f = $("#p-estado").value, q = $("#p-buscar").value.trim().toLowerCase();
    const l = data.filter((p) => (f === "" || (f === "abiertos" ? abierto(p) : p.estado === f)) &&
      (!q || [p.nombre, p.lugar, p.clientes?.nombre, p.descripcion].some((v) => String(v ?? "").toLowerCase().includes(q))));
    const suma = l.reduce((s, p) => s + total(p), 0);
    $("#p-conteo").textContent = `${l.length} proyecto${l.length === 1 ? "" : "s"}${l.length ? " · Total materiales " + clp(suma) : ""}`;
    $("#p-lista").innerHTML = l.length ? l.map((p) => `
      <a class="tarjeta" href="#/pendientes/${p.id}">
        <div class="t-top"><strong>${esc(p.nombre)}</strong><span>${chip(p.estado)}</span></div>
        <div class="muted">${[p.lugar, p.clientes?.nombre].filter(Boolean).map(esc).join(" · ") || "Sin lugar indicado"}</div>
        <div class="muted small">${p.fecha_estimada ? "Fecha estimada " + fecha(p.fecha_estimada) : "Sin fecha estimada"}
          ${atrasado(p) ? ` <span class="chip mal">Atrasado</span>` : ""}
          · ${p.proyecto_materiales.length} material${p.proyecto_materiales.length === 1 ? "" : "es"} · <b>${clp(total(p))}</b>${p.agregar_iva ? " con IVA" : ""}</div>
      </a>`).join("")
      : `<p class="vacio">${data.length ? "No hay proyectos con este filtro." : "Todavía no hay proyectos. Toca “+ Nuevo proyecto”."}</p>`;
  };
  $("#p-estado").onchange = pintar;
  $("#p-buscar").oninput = pintar;
  $("#p-csv").onclick = () => descargarCSV("proyectos-pendientes",
    ["Proyecto", "Lugar", "Cliente", "Fecha estimada", "Estado", "Materiales", "Neto", "IVA", "Total", "Detalle", "Creado"],
    data.map((p) => {
      const m = montos(p.proyecto_materiales, p.agregar_iva);
      return [p.nombre, p.lugar, p.clientes?.nombre, p.fecha_estimada, p.estado, p.proyecto_materiales.length,
        m.neto, m.iva, m.total, p.descripcion, fmtHora(p.creado_en)];
    }));
  pintar();
}

// ---------- Ficha ----------
async function ficha(id) {
  cargando();
  const volver = `<a href="#/pendientes" class="volver">← Proyectos pendientes</a>`;
  const { data: p, error } = await sb.from("proyectos_pendientes")
    .select("*, clientes(nombre), proyecto_materiales(*)").eq("id", id).maybeSingle();
  if (error || !p) return vista(`${volver}<p class="vacio">${esc(error ? msgError(error) : "No se encontró el proyecto.")}</p>`);
  const mats = [...p.proyecto_materiales].sort((a, b) => a.posicion - b.posicion);
  const m = montos(mats, p.agregar_iva);

  const v = vista(`${volver}
    <div class="panel"><div class="cabecera">
      <h1 style="margin:0">${esc(p.nombre)}</h1><span>${chip(p.estado)}</span>
    </div></div>
    <div class="panel"><h2>Datos</h2><dl class="datos">
      ${dato("Dónde", esc(p.lugar || ""))}
      ${dato("Cliente", esc(p.clientes?.nombre || ""))}
      ${dato("Fecha estimada", p.fecha_estimada ? fecha(p.fecha_estimada) + (atrasado(p) ? ' <span class="chip mal">Atrasado</span>' : "") : "")}
      ${dato("Detalle", esc(p.descripcion || ""))}
    </dl></div>

    <div class="panel"><h2>Materiales</h2>
      ${mats.length ? `<div class="tabla-wrap"><table class="tabla">
        <thead><tr><th>Material</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Precio unit.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${mats.map((x) => `<tr><td>${esc(x.descripcion)}</td><td class="num">${nf.format(x.cantidad)}</td>
          <td>${esc(x.unidad || "")}</td><td class="num">${clp(x.precio)}</td><td class="num">${clp(x.subtotal)}</td></tr>`).join("")}</tbody>
      </table></div>
      <dl class="totales">
        ${p.agregar_iva ? `<dt>Neto</dt><dd>${clp(m.neto)}</dd><dt>IVA 19%</dt><dd>${clp(m.iva)}</dd>` : ""}
        <dt>Total${p.agregar_iva ? " con IVA" : ""}</dt><dd><b>${clp(m.total)}</b></dd>
      </dl>` : `<p class="muted small" style="margin:0">Sin materiales. Agrégalos con “Editar”.</p>`}
    </div>

    <div class="fila-acciones">
      <a class="btn primary" href="#/pendientes/${p.id}/editar">Editar</a>
      ${mats.length ? `<button type="button" id="pp-csv">Exportar materiales</button>` : ""}
      ${esAdmin() ? `<button type="button" class="peligro" id="pp-eliminar">Eliminar</button>` : ""}
    </div>
    <p class="muted small">Creado ${fecha(p.creado_en)} · Última modificación ${fecha(p.actualizado_en)}</p>`);

  $("#pp-csv", v) && ($("#pp-csv", v).onclick = () => descargarCSV("materiales-" + p.nombre.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40),
    ["Material", "Cantidad", "Unidad", "Precio unitario", "Subtotal"],
    [...mats.map((x) => [x.descripcion, Number(x.cantidad), x.unidad, Number(x.precio), Number(x.subtotal)]),
      ...(p.agregar_iva ? [["Neto", "", "", "", m.neto], ["IVA 19%", "", "", "", m.iva]] : []),
      ["Total", "", "", "", m.total]]));
  $("#pp-eliminar", v) && ($("#pp-eliminar", v).onclick = async () => {
    if (!confirm(`¿Eliminar el proyecto “${p.nombre}” y su lista de materiales? No se puede deshacer.`)) return;
    const { error: e } = await sb.from("proyectos_pendientes").delete().eq("id", id);
    if (e) return aviso(msgError(e), true);
    aviso("Proyecto eliminado.");
    location.hash = "#/pendientes";
  });
}

// ---------- Formulario ----------
async function formulario(id) {
  cargando();
  let p = { nombre: "", lugar: "", cliente_id: "", fecha_estimada: "", descripcion: "", estado: "Pendiente", agregar_iva: false, proyecto_materiales: [] };
  const volver = id ? `#/pendientes/${id}` : "#/pendientes";
  if (id) {
    const { data, error } = await sb.from("proyectos_pendientes").select("*, proyecto_materiales(*)").eq("id", id).maybeSingle();
    if (error || !data) return vista(`<a href="#/pendientes" class="volver">← Proyectos pendientes</a><p class="vacio">No se encontró el proyecto.</p>`);
    p = data;
  }
  const clientes = await clientesEmpresa();
  const mats = [...p.proyecto_materiales].sort((a, b) => a.posicion - b.posicion);
  const v = vista(`
    <a href="${volver}" class="volver">← Volver</a>
    <h1>${id ? "Editar proyecto" : "Nuevo proyecto pendiente"}</h1>
    <form id="form-pp" novalidate>
      <div class="panel">
        <label for="f-nombre" class="req">Proyecto</label>
        <input id="f-nombre" value="${esc(p.nombre)}" placeholder="Ej.: Cambio de tablero general bodega 2" required>
        <div class="grid2">
          <div><label for="f-lugar">Dónde se hará</label><input id="f-lugar" value="${esc(p.lugar || "")}" placeholder="Dirección, planta o sector"></div>
          <div><label for="f-fecha">Fecha estimada</label><input id="f-fecha" type="date" value="${esc(p.fecha_estimada || "")}"></div>
          <div><label for="f-cliente">Cliente</label><select id="f-cliente"><option value="">— Sin cliente —</option>
            ${clientes.map((c) => `<option value="${c.id}"${c.id === p.cliente_id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></div>
          <div><label for="f-estado">Estado</label><select id="f-estado">
            ${ESTADOS.map((e) => `<option${e === p.estado ? " selected" : ""}>${e}</option>`).join("")}</select></div>
        </div>
        <label for="f-desc">Detalle</label><textarea id="f-desc" rows="3">${esc(p.descripcion || "")}</textarea>
      </div>

      <div class="panel"><h2>Materiales</h2>
        <div class="mat-fila mat-cab" aria-hidden="true"><span>Material</span><span>Cantidad</span><span>Unidad</span><span>Precio unit.</span><span class="num">Subtotal</span><span></span></div>
        <div id="f-mats"></div>
        <button type="button" id="f-agregar">+ Agregar material</button>
        <label class="check-linea"><input type="checkbox" id="f-iva"${p.agregar_iva ? " checked" : ""}> Los precios son netos: sumar IVA (19%) al total</label>
        <dl class="totales" id="f-totales"></dl>
      </div>

      <div class="guardar"><a class="btn" href="${volver}">Cancelar</a>
        <button class="primary" type="submit" id="btn-guardar">${id ? "Guardar cambios" : "Crear proyecto"}</button></div>
    </form>`);

  const cont = $("#f-mats", v);
  const fila = (x = {}) => {
    const d = document.createElement("div");
    d.className = "mat-fila";
    d.innerHTML = `
      <input class="m-desc" value="${esc(x.descripcion || "")}" placeholder="Material" aria-label="Material">
      <input class="m-cant" type="number" inputmode="decimal" min="0" step="any" value="${esc(x.cantidad ?? 1)}" aria-label="Cantidad">
      <input class="m-unid" value="${esc(x.unidad || "")}" placeholder="un, m, kg…" aria-label="Unidad">
      <input class="m-prec" type="number" inputmode="decimal" min="0" step="any" value="${esc(x.precio ?? "")}" placeholder="$" aria-label="Precio unitario">
      <span class="m-sub num"></span>
      <button type="button" class="m-quitar chico" aria-label="Quitar material">✕</button>`;
    cont.appendChild(d);
    return d;
  };
  const leer = () => $$(".mat-fila:not(.mat-cab)", cont).map((d) => ({
    descripcion: $(".m-desc", d).value.trim(), unidad: $(".m-unid", d).value.trim(),
    cantidad: $(".m-cant", d).value, precio: $(".m-prec", d).value,
  }));
  const recalcular = () => {
    for (const d of $$(".mat-fila", cont)) {
      $(".m-sub", d).textContent = clp((Number($(".m-cant", d).value) || 0) * (Number($(".m-prec", d).value) || 0));
    }
    const m = montos(leer().filter((x) => x.descripcion), $("#f-iva").checked);
    $("#f-totales").innerHTML = ($("#f-iva").checked ? `<dt>Neto</dt><dd>${clp(m.neto)}</dd><dt>IVA 19%</dt><dd>${clp(m.iva)}</dd>` : "") +
      `<dt>Total${$("#f-iva").checked ? " con IVA" : ""}</dt><dd><b>${clp(m.total)}</b></dd>`;
  };
  (mats.length ? mats : [{}]).forEach((x) => fila(x));
  recalcular();
  cont.addEventListener("input", recalcular);
  cont.addEventListener("click", (ev) => {
    const b = ev.target.closest(".m-quitar");
    if (!b) return;
    b.closest(".mat-fila").remove();
    if (!$(".mat-fila", cont)) fila();
    recalcular();
  });
  $("#f-iva").onchange = recalcular;
  $("#f-agregar").onclick = () => { $(".m-desc", fila()).focus(); recalcular(); };
  // Enter en el último precio agrega otra fila (más rápido al cargar listas largas)
  cont.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !ev.target.matches(".m-prec, .m-desc, .m-cant, .m-unid")) return;
    ev.preventDefault();
    const d = ev.target.closest(".mat-fila");
    if (ev.target.matches(".m-prec") && d === cont.lastElementChild) { $(".m-desc", fila()).focus(); recalcular(); }
  });

  $("#form-pp", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const nombre = $("#f-nombre").value.trim();
    if (!nombre) { $("#f-nombre").focus(); return aviso("Indica el nombre del proyecto.", true); }
    const items = leer().filter((x) => x.descripcion || x.precio);
    const malo = items.findIndex((x) => !x.descripcion || Number(x.cantidad) < 0 || Number(x.precio) < 0 || x.cantidad === "");
    if (malo >= 0) return aviso(`Revisa el material ${malo + 1}: necesita nombre, cantidad y un precio no negativo.`, true);
    const btn = $("#btn-guardar");
    btn.disabled = true;
    const { data, error } = await sb.rpc("pp_guardar", {
      p_id: id || null,
      p_datos: {
        empresa_id: H.empresa.id, nombre, lugar: $("#f-lugar").value, fecha_estimada: $("#f-fecha").value,
        cliente_id: $("#f-cliente").value, descripcion: $("#f-desc").value, estado: $("#f-estado").value,
        agregar_iva: $("#f-iva").checked,
      },
      p_materiales: items.map((x) => ({ ...x, cantidad: Number(x.cantidad) || 0, precio: Number(x.precio) || 0 })),
    });
    if (error) { btn.disabled = false; return aviso("Error al guardar: " + msgError(error), true); }
    aviso(id ? "Cambios guardados." : "Proyecto creado.");
    location.hash = "#/pendientes/" + data;
  };
}

// Horus · Calendario de visitas (Lafken): clientes frecuentes con un servicio cada N semanas o meses.
// La próxima visita la calcula la base de datos (proximas_visitas) desde el último servicio de ese tipo al cliente.
// El supervisor (jefe) o admin crea y edita los planes; todo el personal los ve. La campanita avisa 7 días antes.
import {
  sb, H, $, $$, esc, aviso, msgError, vista, cargando, fecha, hoy, opcionesServicio, esJefe, esAdmin,
  campoCliente, activarCampoCliente, clienteElegido, moduloActivo, normalizarRut, olvidarClientes,
} from "./nucleo.js";

export const rutas = [
  { patron: /^#\/servicios\/calendario$/, modulo: "servicios", acceso: "staff", render: () => calendario() },
  { patron: /^#\/avisos$/, acceso: "staff", render: () => avisos() },
];

export const AVISO_DIAS = 7;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

// Fecha + N días, semanas o meses, como en la base de datos (31-ene + 1 mes = 28-feb)
export function sumar(iso, cada, unidad) {
  const [y, m, d] = iso.split("-").map(Number);
  if (unidad !== "meses") return new Date(Date.UTC(y, m - 1, d + (unidad === "semanas" ? 7 : 1) * cada)).toISOString().slice(0, 10);
  const ultimoDia = new Date(Date.UTC(y, m - 1 + cada + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + cada, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}
const diasHasta = (iso) => Math.round((Date.parse(iso) - Date.parse(hoy())) / 86400000);
const UNIDAD = { dias: ["día", "días"], semanas: ["semana", "semanas"], meses: ["mes", "meses"] };
const cadaTxt = (p) => (p.cada === 1 ? `cada ${UNIDAD[p.unidad][0]}` : `cada ${p.cada} ${UNIDAD[p.unidad][1]}`);
const cuando = (p) => {
  const n = diasHasta(p.proxima);
  return n < 0 ? `<span class="chip mal">Atrasada ${-n} día${n === -1 ? "" : "s"}</span>`
    : n === 0 ? `<span class="chip warn">Hoy</span>`
    : n <= AVISO_DIAS ? `<span class="chip warn">En ${n} día${n === 1 ? "" : "s"}</span>` : "";
};

// Planes con su próxima visita (se guarda 5 minutos para la campanita, que se pinta en cada cambio de pantalla)
let cache = { clave: null, t: 0, datos: [] }, cacheSinRut = { clave: null, t: 0, datos: [] };
export function olvidarAvisos() { cache.t = 0; cacheSinRut.t = 0; }
// Clientes creados sin RUT (urgentes): aparecen en la campanita hasta que alguien completa su RUT
async function sinRut(forzar = false) {
  const clave = H.empresa?.id;
  if (!forzar && cacheSinRut.clave === clave && Date.now() - cacheSinRut.t < 300000) return cacheSinRut.datos;
  const { data, error } = await sb.rpc("clientes_sin_rut", { p_empresa: clave });
  if (error) throw error;
  cacheSinRut = { clave, t: Date.now(), datos: data };
  return data;
}
async function planes(forzar = false) {
  const clave = H.empresa?.id;
  if (!forzar && cache.clave === clave && Date.now() - cache.t < 300000) return cache.datos;
  const { data, error } = await sb.rpc("proximas_visitas", { p_empresa: clave });
  if (error) throw error;
  cache = { clave, t: Date.now(), datos: data };
  return data;
}
// Campanita: clientes sin RUT + visitas atrasadas o de los próximos 7 días. Si algo falla, no molesta: 0.
export async function contarAvisos() {
  let n = 0;
  try { n += (await sinRut()).length; } catch { /* sin la función en la base todavía */ }
  if (moduloActivo("servicios")) {
    try { n += (await planes()).filter((p) => p.activo && diasHasta(p.proxima) <= AVISO_DIAS).length; } catch { /* idem */ }
  }
  return n;
}

// Página de la campanita
async function avisos() {
  cargando();
  let urgentes = [], visitas = [];
  try {
    urgentes = await sinRut(true);
    if (moduloActivo("servicios")) visitas = (await planes(true)).filter((p) => p.activo && diasHasta(p.proxima) <= AVISO_DIAS);
  } catch (e) { vista(`<p class="vacio">${esc(msgError(e))}</p>`); return; }
  const v = vista(`<h1>Avisos</h1>
    <div class="panel"><h2>Clientes sin RUT <span class="chip mal">Urgente</span></h2>
      <p class="muted small">Se crearon sin RUT. Escribe el RUT y guárdalo para que queden bien como clientes.</p>
      <div id="av-rut" class="lista">${urgentes.length ? urgentes.map((c) => `<div class="tarjeta"><div class="t-top">
        <div><strong>${esc(c.nombre)}</strong><div class="muted small">Creado el ${fecha(c.creado_en)}</div></div>
        <div class="acciones" style="margin:0"><input aria-label="RUT de ${esc(c.nombre)}" placeholder="12.345.678-9" data-rut="${c.id}" style="width:150px">
          <button class="chico primary" data-guardar="${c.id}">Guardar RUT</button></div></div></div>`).join("")
        : `<p class="muted">No hay clientes sin RUT.</p>`}</div></div>
    ${moduloActivo("servicios") ? `<div class="panel"><h2>Visitas atrasadas o de los próximos ${AVISO_DIAS} días</h2>
      <div class="lista">${visitas.length ? visitas.map((p) => `<div class="tarjeta"><div class="t-top">
        <div><strong>${esc(p.cliente)}</strong> · ${esc(p.tipo)}<div class="muted small">próxima: <b>${fecha(p.proxima)}</b></div></div>
        <div class="acciones" style="margin:0">${cuando(p)}</div></div></div>`).join("") : `<p class="muted">No hay visitas próximas.</p>`}</div>
      <a class="btn" href="#/servicios/calendario">Ver calendario</a></div>` : ""}`);
  $("#av-rut", v).onclick = async (ev) => {
    const id = ev.target.closest("[data-guardar]")?.dataset.guardar;
    if (!id) return;
    const campo = $(`[data-rut="${id}"]`, v), rut = normalizarRut(campo.value);
    if (!rut) { campo.focus(); return aviso("El RUT no es válido.", true); }
    const { error } = await sb.rpc("completar_rut", { p_cliente: id, p_rut: rut });
    if (error) return aviso(msgError(error), true);
    olvidarAvisos(); olvidarClientes();
    aviso("RUT guardado.");
    document.dispatchEvent(new Event("horus-avisos"));
    avisos();
  };
}

async function calendario() {
  cargando();
  let datos;
  try { datos = await planes(true); } catch (e) { vista(`<p class="vacio">${esc(msgError(e))}</p>`); return; }
  const puede = esJefe();
  const tipos = opcionesServicio().filter((t) => t !== "Otros");
  let mes = hoy().slice(0, 7); // "aaaa-mm"
  const v = vista(`
    <a href="#/servicios" class="volver">← Servicios</a>
    <div class="cabecera"><h1>Calendario de visitas</h1>${puede ? `<button class="primary" id="cal-nuevo">+ Nuevo plan</button>` : ""}</div>
    <div class="panel"><h2>Próximas ${AVISO_DIAS} días y atrasadas</h2><div id="cal-pronto" class="lista"></div></div>
    <div class="panel">
      <div class="cal-nav"><button type="button" class="chico" id="cal-ant" aria-label="Mes anterior">‹</button>
        <h2 id="cal-mes" style="margin:0"></h2><button type="button" class="chico" id="cal-sig" aria-label="Mes siguiente">›</button></div>
      <div class="cal" id="cal-grilla"></div>
      <div id="cal-lista-mes" class="lista" style="margin-top:12px"></div>
      <p class="muted small">Las fechas después de la próxima visita son estimadas: se recalculan cuando se registra el servicio.</p>
    </div>
    <div class="panel"><h2>Planes</h2><div id="cal-planes" class="lista"></div></div>
    <dialog id="dlg-plan"><form id="form-plan" method="dialog" novalidate>
      <h2 id="pl-titulo">Nuevo plan</h2>
      <label for="pl-cli" class="req">Cliente</label>${campoCliente("pl-cli")}
      <label for="pl-tipo" class="req">Servicio</label>
      <select id="pl-tipo">${tipos.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
      <div class="grid2">
        <div><label for="pl-cada" class="req">Cada</label><input id="pl-cada" type="number" min="1" max="365" step="1" value="2" inputmode="numeric"></div>
        <div><label for="pl-unidad">&nbsp;</label><select id="pl-unidad"><option value="meses">meses</option><option value="semanas">semanas</option><option value="dias">días</option></select></div>
      </div>
      <label for="pl-inicio" class="req">Primera visita</label><input id="pl-inicio" type="date">
      <p class="muted small" style="margin:4px 0 0">Si el cliente ya tiene este servicio registrado, la próxima visita se cuenta desde el último.</p>
      <label for="pl-notas">Notas</label><textarea id="pl-notas" rows="2"></textarea>
      <div class="pie"><button type="button" id="pl-cancelar">Cancelar</button><button class="primary" type="submit">Guardar</button></div>
    </form></dialog>`);

  const fila = (p, extra = "") => `<div class="tarjeta"><div class="t-top">
      <div><strong>${esc(p.cliente)}</strong> · ${esc(p.tipo)}<div class="muted small">${cadaTxt(p)} · última: ${p.ultima ? fecha(p.ultima) : "—"}
        · próxima: <b>${fecha(p.proxima)}</b>${p.notas ? " · " + esc(p.notas) : ""}</div></div>
      <div class="acciones" style="margin:0">${cuando(p)}${extra}</div></div></div>`;

  const activos = datos.filter((p) => p.activo);
  const pronto = activos.filter((p) => diasHasta(p.proxima) <= AVISO_DIAS);
  $("#cal-pronto", v).innerHTML = pronto.length ? pronto.map((p) => fila(p)).join("") : `<p class="muted">No hay visitas en los próximos ${AVISO_DIAS} días.</p>`;

  $("#cal-planes", v).innerHTML = datos.length ? datos.map((p) => fila(p, `${p.activo ? "" : `<span class="chip">Pausado</span>`}
      ${puede ? `<button class="chico" data-editar="${p.id}">Editar</button>
      <button class="chico" data-pausar="${p.id}">${p.activo ? "Pausar" : "Reanudar"}</button>` : ""}
      ${esAdmin() ? `<button class="chico peligro" data-borrar="${p.id}">Eliminar</button>` : ""}`)).join("")
    : `<p class="vacio">Aún no hay planes.${puede ? " Usa “+ Nuevo plan”." : " Los crea el supervisor."}</p>`;

  // Mes: grilla con la cantidad de visitas por día y la lista de visitas del mes
  const pintarMes = () => {
    const [y, m] = mes.split("-").map(Number);
    const desde = `${mes}-01`, dias = new Date(Date.UTC(y, m, 0)).getUTCDate(), hasta = `${mes}-${String(dias).padStart(2, "0")}`;
    const visitas = [];
    for (const p of activos) {
      let d = p.proxima;
      while (d < desde) d = sumar(d, p.cada, p.unidad);
      for (; d <= hasta; d = sumar(d, p.cada, p.unidad)) visitas.push({ ...p, dia: d, estimada: d !== p.proxima });
    }
    visitas.sort((a, b) => a.dia.localeCompare(b.dia) || a.cliente.localeCompare(b.cliente));
    const porDia = {};
    visitas.forEach((x) => (porDia[x.dia] = (porDia[x.dia] || 0) + 1));
    const blancos = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes primero
    $("#cal-mes").textContent = `${MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1)} ${y}`;
    $("#cal-grilla").innerHTML = DIAS.map((d) => `<div class="cal-dia-nombre">${d}</div>`).join("")
      + "<div></div>".repeat(blancos)
      + Array.from({ length: dias }, (_, i) => {
        const iso = `${mes}-${String(i + 1).padStart(2, "0")}`, n = porDia[iso];
        return `<div class="cal-dia${iso === hoy() ? " hoy" : ""}${n ? " con" : ""}">${i + 1}${n ? `<span>${n}</span>` : ""}</div>`;
      }).join("");
    $("#cal-lista-mes").innerHTML = visitas.length ? visitas.map((x) => `<div class="tarjeta">
        <strong>${fecha(x.dia)}</strong> · ${esc(x.cliente)} · ${esc(x.tipo)}${x.estimada ? ` <span class="muted small">(estimada)</span>` : ""}</div>`).join("")
      : `<p class="muted">Sin visitas este mes.</p>`;
  };
  const mover = (k) => {
    const [y, m] = mes.split("-").map(Number);
    mes = new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7);
    pintarMes();
  };
  $("#cal-ant", v).onclick = () => mover(-1);
  $("#cal-sig", v).onclick = () => mover(1);
  pintarMes();

  // Crear / editar planes (supervisor o admin)
  const dlg = $("#dlg-plan", v), cli = $("#pl-cli", v);
  activarCampoCliente(cli);
  let editando = null;
  const abrir = (p = null) => {
    editando = p;
    $("#pl-titulo").textContent = p ? "Editar plan" : "Nuevo plan";
    cli.value = p?.cliente || ""; cli.dataset.id = p?.cliente_id || ""; cli.dataset.rut = "";
    if (p && !tipos.includes(p.tipo)) $("#pl-tipo").insertAdjacentHTML("beforeend", `<option>${esc(p.tipo)}</option>`);
    $("#pl-tipo").value = p?.tipo || tipos[0] || "";
    $("#pl-cada").value = p?.cada || 2;
    $("#pl-unidad").value = p?.unidad || "meses";
    $("#pl-inicio").value = p?.inicio || hoy();
    $("#pl-notas").value = p?.notas || "";
    dlg.showModal();
  };
  if (puede) $("#cal-nuevo", v).onclick = () => abrir();
  $("#pl-cancelar", v).onclick = () => dlg.close();
  $("#form-plan", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const cliente_id = await clienteElegido(cli);
    if (cliente_id === undefined) return;
    if (!cliente_id) return aviso("Elige el cliente.", true);
    const cada = Number($("#pl-cada").value);
    if (!Number.isInteger(cada) || cada < 1 || cada > 365) return aviso("“Cada” debe ser un número entre 1 y 365.", true);
    if (!$("#pl-inicio").value) return aviso("Indica la primera visita.", true);
    const datosPlan = { cliente_id, tipo: $("#pl-tipo").value, cada, unidad: $("#pl-unidad").value,
      inicio: $("#pl-inicio").value, notas: $("#pl-notas").value.trim() || null };
    const { error } = editando
      ? await sb.from("planes_visita").update(datosPlan).eq("id", editando.id)
      : await sb.from("planes_visita").insert({ ...datosPlan, empresa_id: H.empresa.id });
    if (error) return aviso(msgError(error), true);
    dlg.close();
    aviso("Plan guardado.");
    olvidarAvisos();
    calendario();
  };
  $("#cal-planes", v).onclick = async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const p = datos.find((x) => x.id === (b.dataset.editar || b.dataset.pausar || b.dataset.borrar));
    if (!p) return;
    if (b.dataset.editar) return abrir(p);
    if (b.dataset.borrar && !confirm(`¿Eliminar el plan de ${p.cliente} (${p.tipo})? Los servicios registrados no se borran.`)) return;
    const { error } = b.dataset.borrar
      ? await sb.from("planes_visita").delete().eq("id", p.id)
      : await sb.from("planes_visita").update({ activo: !p.activo }).eq("id", p.id);
    if (error) return aviso(msgError(error), true);
    olvidarAvisos();
    calendario();
  };
}

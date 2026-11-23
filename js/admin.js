// Horus · Administración (solo rol admin)
import {
  sb, H, MODULOS, ROLES, ROLES_EMPRESA, PERMISOS, $, $$, esc, aviso, msgError, vista, cargando, fmtHora,
  clientesEmpresa, olvidarClientes, normalizarRut, normalizarTelefono, validarCampo, msgCarga, nf,
} from "./nucleo.js";
import { leerArchivo, separarEncabezado, normal } from "./excel.js";

export const rutas = [
  { patron: /^#\/admin$/, acceso: "admin", render: () => menu() },
  { patron: /^#\/admin\/usuarios$/, acceso: "admin", render: () => usuarios() },
  { patron: /^#\/admin\/clientes$/, acceso: "admin", render: () => clientes() },
  { patron: /^#\/admin\/personal$/, acceso: "admin", render: () => personal() },
  { patron: /^#\/admin\/dispositivos$/, acceso: "admin", render: () => dispositivos() },
  { patron: /^#\/admin\/empresas$/, acceso: "admin", render: () => empresas() },
  { patron: /^#\/admin\/auditoria$/, acceso: "admin", render: () => auditoria() },
  { patron: /^#\/admin\/ruts$/, acceso: "admin", render: () => rutClientes() },
];

// [ruta, título, descripción (se ve al pasar el mouse), icono SVG de línea]
const SECCIONES = [
  ["usuarios", "Usuarios", "Crear cuentas y asignar rol: administrador, jefe eléctrico / supervisor, operario o cliente.",
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'],
  ["clientes", "Clientes", "Clientes de la empresa activa y qué módulos puede ver cada uno.",
    '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'],
  ["personal", "Personal", "Trabajadores que se asignan a los servicios y a las órdenes de trabajo.",
    '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/>'],
  ["dispositivos", "Sala de bombas", "Módulos ESP32: a qué cliente pertenecen, clave y umbrales de alarma.",
    '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>'],
  ["empresas", "Empresas y módulos", "Qué módulos usa cada empresa.",
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'],
  ["auditoria", "Historial de cambios", "Quién creó, editó o borró cada registro.",
    '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'],
  ["ruts", "RUT Clientes", "Busca clientes por nombre, RUT o comuna. La lista se carga desde un CSV.",
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'],
  ["excel", "Buscador de Excel", "Abre planillas (compras, ventas…) y búscalas por mes, empresa o texto. No se guardan.",
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'],
];
const cabecera = (titulo, extra = "") =>
  `<a href="#/admin" class="volver">← Administración</a><div class="cabecera"><h1>${titulo}</h1>${extra}</div>`;
const empresaActiva = () => `<span class="chip info">${esc(H.empresa?.nombre)}</span>`;

function menu() {
  vista(`<h1>Administración</h1><div class="iconos">
    ${SECCIONES.map(([k, t, d, svg]) => `<a class="tarjeta icono" href="#/admin/${k}" title="${d}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><strong>${t}</strong></a>`).join("")}
  </div>`);
}

// ---------- Usuarios ----------
async function usuarios() {
  cargando();
  const [p, c] = await Promise.all([
    sb.from("perfiles").select("*").order("email"),
    sb.from("clientes").select("id, nombre, empresa_id").order("nombre"),
  ]);
  if (p.error) return vista(`<p class="vacio">${esc(msgError(p.error))}</p>`);
  const todosClientes = c.data || [];
  const hayPermisos = p.data.some((u) => "permisos" in u);
  const optEmpresas = (sel) => `<option value="">—</option>` + H.empresas.map((e) => `<option value="${e.id}"${e.id === sel ? " selected" : ""}>${esc(e.nombre)}</option>`).join("");
  const optClientes = (sel) => `<option value="">—</option>` + H.empresas.map((e) => `<optgroup label="${esc(e.nombre)}">
      ${todosClientes.filter((x) => x.empresa_id === e.id).map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.nombre)}</option>`).join("")}</optgroup>`).join("");
  const optRoles = (sel) => Object.entries(ROLES).map(([k, t]) => `<option value="${k}"${k === sel ? " selected" : ""}>${t}</option>`).join("");

  const v = vista(cabecera("Usuarios", `<button class="primary" id="btn-nuevo">+ Nuevo usuario</button>`) + `
    <p class="muted small">Operario: ve y edita todo lo de su empresa, pero no borra ni gestiona clientes, personal o usuarios.
      Jefe eléctrico: lo mismo que un operario, y además crea órdenes de trabajo, asigna personal y verifica los trabajos terminados (tampoco borra).
      En Lafken el jefe es el <b>Supervisor</b>: pasa las sanitizaciones de cotizado a coordinado y de coordinado a finalizado.
      Los <b>permisos</b> (por ejemplo Bobinado) se dan a cada operario o jefe por separado.
      Cliente: solo lectura de sus equipos, servicios y sala de bombas.</p>
    <div class="tabla-wrap"><table class="tabla">
      <thead><tr><th>Usuario</th><th>Rol</th><th>Empresa</th><th>Cliente</th><th>Permisos</th><th>Activo</th><th></th></tr></thead>
      <tbody>${p.data.map((u) => {
        const yo = u.id === H.perfil.id;
        return `<tr data-id="${u.id}">
          <td><input class="u-nombre" value="${esc(u.nombre || "")}" placeholder="Nombre" ${yo ? "disabled" : ""} style="min-width:150px">
            <div class="muted small">${esc(u.email)}${yo ? " (tú)" : ""}</div></td>
          <td><select class="u-rol" ${yo ? "disabled" : ""}>${optRoles(u.rol)}</select></td>
          <td><select class="u-emp" ${yo ? "disabled" : ""}>${optEmpresas(u.empresa_id)}</select></td>
          <td><select class="u-cli" ${yo ? "disabled" : ""}>${optClientes(u.cliente_id)}</select></td>
          <td class="u-perms">${Object.entries(PERMISOS).map(([k, t]) => `<label class="perm"><input type="checkbox" class="u-perm" value="${k}"
            ${(u.permisos || []).includes(k) || u.rol === "admin" ? "checked" : ""} ${yo ? "disabled" : ""}> ${t}</label>`).join("")}</td>
          <td><input type="checkbox" class="u-act" ${u.activo ? "checked" : ""} ${yo ? "disabled" : ""}></td>
          <td>${yo ? "" : `<div class="acciones" style="margin:0;flex-wrap:nowrap">
            <button class="chico primary u-guardar">Guardar</button>
            <button class="chico u-clave">Clave</button>
            <button class="chico peligro u-borrar">Eliminar</button></div>`}</td>
        </tr>`;
      }).join("")}</tbody></table></div>

    <dialog id="dlg-u"><form id="form-u" method="dialog">
      <h2>Nuevo usuario</h2>
      <label for="n-email" class="req">Correo</label><input id="n-email" type="email" required>
      <label for="n-nombre">Nombre</label><input id="n-nombre">
      <label for="n-clave" class="req">Contraseña inicial (mín. 8)</label>
      <div style="display:flex;gap:8px"><input id="n-clave" type="password" minlength="8" required autocomplete="new-password" style="flex:1">
        <button type="button" class="chico" id="n-ver-clave" aria-pressed="false">Mostrar</button></div>
      <label for="n-rol">Rol</label><select id="n-rol">${optRoles("operario")}</select>
      <div id="n-emp-w"><label for="n-emp">Empresa</label><select id="n-emp">${optEmpresas(H.empresa?.id)}</select>
        <div class="checks" style="margin-top:10px"><label><input type="checkbox" id="n-personal" checked> Agregar también a Personal (para asignarlo a servicios)</label>
          ${Object.entries(PERMISOS).map(([k, t]) => `<label><input type="checkbox" class="n-perm" value="${k}"> Puede entrar a ${t}</label>`).join("")}</div></div>
      <div id="n-cli-w" hidden><label for="n-cli">Cliente</label><select id="n-cli">${optClientes()}</select>
        <div class="ayuda">${todosClientes.length ? "El usuario verá solo los datos de este cliente." : "Aún no hay clientes: créalos primero en Administración → Clientes."}</div></div>
      <p class="muted small">Entrégale el correo y la contraseña a la persona; al entrar por primera vez tendrá que elegir una nueva.</p>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Crear</button></div>
    </form></dialog>`, true);

  const sync = (rolSel, empW, cliW) => { empW.hidden = !ROLES_EMPRESA.includes(rolSel.value); cliW.hidden = rolSel.value !== "cliente"; };
  sync($("#n-rol"), $("#n-emp-w"), $("#n-cli-w"));
  $("#n-rol").onchange = () => sync($("#n-rol"), $("#n-emp-w"), $("#n-cli-w"));
  $("#btn-nuevo").onclick = () => $("#dlg-u").showModal();
  $("#n-ver-clave").onclick = (ev) => {
    const ver = $("#n-clave").type === "password";
    $("#n-clave").type = ver ? "text" : "password";
    ev.target.textContent = ver ? "Ocultar" : "Mostrar";
    ev.target.setAttribute("aria-pressed", ver);
  };
  $("[data-cerrar]", v).onclick = () => $("#dlg-u").close();

  $("#form-u").onsubmit = async (ev) => {
    ev.preventDefault();
    const rol = $("#n-rol").value;
    const datos = {
      accion: "crear", email: $("#n-email").value.trim(), password: $("#n-clave").value, nombre: $("#n-nombre").value.trim() || null,
      // El jefe se crea como operario y luego se sube a jefe (así funciona aunque la función "usuarios"
      // instalada en Supabase sea anterior al rol jefe)
      rol: rol === "jefe" ? "operario" : rol,
      empresa_id: ROLES_EMPRESA.includes(rol) ? $("#n-emp").value || null : null, cliente_id: rol === "cliente" ? $("#n-cli").value || null : null,
    };
    if (ROLES_EMPRESA.includes(rol) && !datos.empresa_id) return aviso("Elige la empresa.", true);
    if (rol === "cliente" && !datos.cliente_id) return aviso("Elige el cliente.", true);
    const r = await funcionUsuarios(datos);
    if (!r) return;
    $("#dlg-u").close();
    let msg = "Usuario creado.";
    const permisos = ROLES_EMPRESA.includes(rol) ? $$(".n-perm:checked").map((i) => i.value) : [];
    if ((permisos.length || rol === "jefe") && r.id) {
      const { error } = await sb.from("perfiles").update({ permisos, rol }).eq("id", r.id);
      if (error) msg = "Usuario creado, pero no se pudo guardar el rol o el permiso: " + msgError(error);
    }
    if (ROLES_EMPRESA.includes(rol) && $("#n-personal").checked && r.id) {
      const e = await vincularPersonal(r.id, datos.empresa_id, datos.nombre || datos.email.split("@")[0]);
      msg = e ? `Usuario creado, pero no se pudo agregar a Personal: ${e}` : "Usuario creado y agregado a Personal.";
    }
    aviso(msg, msg.includes("no se pudo"));
    usuarios();
  };

  for (const tr of $$("tbody tr[data-id]", v)) {
    const id = tr.dataset.id;
    const rolSel = $(".u-rol", tr), emp = $(".u-emp", tr), cli = $(".u-cli", tr);
    const ajustar = () => {
      const deEmpresa = ROLES_EMPRESA.includes(rolSel.value);
      emp.disabled = !deEmpresa || rolSel.disabled; cli.disabled = rolSel.value !== "cliente" || rolSel.disabled;
      // El admin tiene todos los permisos; el cliente ninguno
      $$(".u-perm", tr).forEach((i) => {
        i.disabled = !deEmpresa || rolSel.disabled;
        if (rolSel.value === "admin") i.checked = true; else if (!deEmpresa) i.checked = false;
      });
    };
    ajustar();
    rolSel.onchange = ajustar;
    $(".u-guardar", tr) && ($(".u-guardar", tr).onclick = async () => {
      const cambios = {
        nombre: $(".u-nombre", tr).value.trim() || null, rol: rolSel.value, activo: $(".u-act", tr).checked,
        empresa_id: ROLES_EMPRESA.includes(rolSel.value) ? emp.value || null : null,
        cliente_id: rolSel.value === "cliente" ? cli.value || null : null,
      };
      // (si todavía no se ejecutó la versión nueva de schema.sql, la columna no existe)
      if (hayPermisos) cambios.permisos = ROLES_EMPRESA.includes(rolSel.value) ? $$(".u-perm:checked", tr).map((i) => i.value) : [];
      if (ROLES_EMPRESA.includes(cambios.rol) && !cambios.empresa_id) return aviso("Elige la empresa.", true);
      if (cambios.rol === "cliente" && !cambios.cliente_id) return aviso("Elige el cliente.", true);
      const { error } = await sb.from("perfiles").update(cambios).eq("id", id);
      if (error) return aviso(msgError(error), true);
      aviso("Usuario actualizado.");
      usuarios();
    });
    $(".u-clave", tr) && ($(".u-clave", tr).onclick = async () => {
      const clave = prompt("Nueva contraseña para este usuario (mínimo 8 caracteres):");
      if (!clave) return;
      if (clave.length < 8) return aviso("La contraseña debe tener al menos 8 caracteres.", true);
      if (await funcionUsuarios({ accion: "clave", id, password: clave })) aviso("Contraseña cambiada. La persona deberá elegir una nueva al entrar.");
    });
    $(".u-borrar", tr) && ($(".u-borrar", tr).onclick = async () => {
      if (!confirm("¿Eliminar este usuario? Ya no podrá entrar. (Si solo quieres bloquearlo, desmarca Activo.)")) return;
      if (await funcionUsuarios({ accion: "eliminar", id })) { aviso("Usuario eliminado."); usuarios(); }
    });
  }
}

// Vincula una cuenta con Personal: si ya hay una persona con ese nombre sin cuenta, la usa; si no, la crea.
// Devuelve null si salió bien, o el mensaje de error.
async function vincularPersonal(usuarioId, empresaId, nombre) {
  const { data: ex } = await sb.from("personal").select("id, usuario_id").eq("empresa_id", empresaId).eq("nombre", nombre).maybeSingle();
  if (ex?.usuario_id && ex.usuario_id !== usuarioId) return `ya existe "${nombre}" vinculado a otra cuenta`;
  const { error } = ex
    ? await sb.from("personal").update({ usuario_id: usuarioId, activo: true }).eq("id", ex.id)
    : await sb.from("personal").insert({ empresa_id: empresaId, nombre, usuario_id: usuarioId });
  return error ? msgError(error) : null;
}

// Crear usuarios y cambiar claves requiere la función de servidor "usuarios" (supabase/functions/usuarios)
async function funcionUsuarios(cuerpo) {
  const { data, error } = await sb.functions.invoke("usuarios", { body: cuerpo });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    if (/Failed to send|not found|404/i.test(msg)) {
      msg = "La función 'usuarios' no está instalada en Supabase. Mientras tanto, crea el usuario en Supabase → Authentication → Users y asígnale el rol aquí.";
    }
    aviso(msg, true);
    return null;
  }
  return data || true;
}

// ---------- Clientes ----------
async function clientes() {
  cargando();
  const lista = await clientesEmpresa(true);
  const mods = ["equipos", "servicios", "sala_bombas"];
  const v = vista(cabecera("Clientes", empresaActiva()) + `
    <form class="panel" id="form-c" novalidate>
      <div class="grid2">
        <div><label for="c-nombre" class="req">Nombre</label><input id="c-nombre" required></div>
        <div><label for="c-rut">RUT</label><input id="c-rut" placeholder="12.345.678-9" autocomplete="off">
          <div class="ayuda">Se revisa el dígito verificador.</div></div>
        <div><label for="c-tel">Teléfono</label><input id="c-tel" type="tel" inputmode="tel" placeholder="+56 9 1234 5678">
          <div class="ayuda">Celular o fijo chileno, 9 dígitos.</div></div>
        <div><label for="c-contacto">Correo / dirección</label><input id="c-contacto"></div>
      </div>
      <div class="acciones" style="margin:12px 0 0"><button class="primary" type="submit">Agregar cliente</button></div>
    </form>
    <div class="lista">${lista.map((c) => `
      <div class="tarjeta">
        <div class="t-top"><div><strong>${esc(c.nombre)}</strong>
          <div class="muted small">${[c.rut, c.telefono, c.contacto].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</div></div>
          <div class="acciones" style="margin:0"><button class="chico" data-ed="${c.id}">Editar</button>
            <button class="chico peligro" data-del="${c.id}">Eliminar</button></div></div>
        <div class="muted small">Puede ver: ${c.modulos.filter((m) => MODULOS[m]).map((m) => MODULOS[m].titulo).join(", ") || "nada"}</div>
      </div>`).join("") || `<p class="vacio">Aún no hay clientes en ${esc(H.empresa.nombre)}.</p>`}</div>

    <dialog id="dlg-c"><form id="form-ce" method="dialog" novalidate>
      <h2>Editar cliente</h2>
      <label for="e-nombre" class="req">Nombre</label><input id="e-nombre" required>
      <label for="e-rut">RUT</label><input id="e-rut" placeholder="12.345.678-9" autocomplete="off">
      <label for="e-tel">Teléfono</label><input id="e-tel" type="tel" inputmode="tel" placeholder="+56 9 1234 5678">
      <label for="e-contacto">Correo / dirección</label><input id="e-contacto">
      <label>Qué puede ver cuando inicia sesión</label>
      <div class="checks">${mods.map((m) => `<label><input type="checkbox" value="${m}" class="e-mod">${MODULOS[m].titulo}</label>`).join("")}</div>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Guardar</button></div>
    </form></dialog>`);

  // Al salir del campo se revisa y se da formato (12.345.678-9 / +56 9 1234 5678)
  const MSG_RUT = "RUT inválido: revisa el número y el dígito verificador.";
  const MSG_TEL = "Teléfono inválido: debe tener 9 dígitos (ej. +56 9 1234 5678).";
  for (const [id, fn, msg] of [["#c-rut", normalizarRut, MSG_RUT], ["#e-rut", normalizarRut, MSG_RUT],
                               ["#c-tel", normalizarTelefono, MSG_TEL], ["#e-tel", normalizarTelefono, MSG_TEL]]) {
    const input = $(id, v);
    input.onblur = () => { if (input.value.trim()) validarCampo(input, fn, msg); else input.removeAttribute("aria-invalid"); };
  }
  const leerDatos = (p) => {
    const nombre = $(`#${p}-nombre`).value.trim();
    if (!nombre) { aviso("Falta el nombre del cliente.", true); $(`#${p}-nombre`).focus(); return null; }
    const rut = validarCampo($(`#${p}-rut`), normalizarRut, MSG_RUT);
    if (rut === undefined) return null;
    const telefono = validarCampo($(`#${p}-tel`), normalizarTelefono, MSG_TEL);
    if (telefono === undefined) return null;
    return { nombre, rut, telefono, contacto: $(`#${p}-contacto`).value.trim() || null };
  };
  const errorCliente = (error) =>
    /rut_valido/.test(error.message) ? MSG_RUT : /telefono_valido/.test(error.message) ? MSG_TEL : msgError(error);

  $("#form-c", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const datos = leerDatos("c");
    if (!datos) return;
    const { error } = await sb.from("clientes").insert({ empresa_id: H.empresa.id, ...datos });
    if (error) return aviso(errorCliente(error), true);
    olvidarClientes();
    aviso("Cliente agregado.");
    clientes();
  };
  let editando = null;
  $("[data-cerrar]", v).onclick = () => $("#dlg-c").close();
  $$("[data-ed]", v).forEach((b) => (b.onclick = () => {
    editando = lista.find((x) => x.id === b.dataset.ed);
    $("#e-nombre").value = editando.nombre;
    $("#e-rut").value = editando.rut || "";
    $("#e-tel").value = editando.telefono || "";
    $("#e-contacto").value = editando.contacto || "";
    $$("#dlg-c [aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
    $$(".e-mod").forEach((i) => (i.checked = editando.modulos.includes(i.value)));
    $("#dlg-c").showModal();
  }));
  $("#form-ce", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const datos = leerDatos("e");
    if (!datos) return;
    const { error } = await sb.from("clientes").update({ ...datos, modulos: $$(".e-mod:checked").map((i) => i.value) }).eq("id", editando.id);
    if (error) return aviso(errorCliente(error), true);
    olvidarClientes();
    $("#dlg-c").close();
    aviso("Cliente actualizado.");
    clientes();
  };
  $$("[data-del]", v).forEach((b) => (b.onclick = async () => {
    const c = lista.find((x) => x.id === b.dataset.del);
    if (!confirm(`¿Eliminar el cliente "${c.nombre}"? Solo se puede si no tiene equipos ni servicios.`)) return;
    const { error } = await sb.from("clientes").delete().eq("id", c.id);
    if (error) return aviso(error.code === "23503" ? "No se puede eliminar: tiene equipos o servicios registrados." : msgError(error), true);
    olvidarClientes();
    aviso("Cliente eliminado.");
    clientes();
  }));
}

// ---------- RUT Clientes ----------
// CSV leído aquí y no con SheetJS: SheetJS adivina el separador mirando también las filas de datos,
// y con muchas facturas separadas por " | " elige "|". Aquí el separador sale solo de la línea de encabezados.
function leerCSV(texto) {
  texto = texto.replace(/^\uFEFF/, "");
  const primera = texto.slice(0, texto.search(/\r?\n|$/));
  const sep = [",", ";", "\t"].reduce((a, s) => (primera.split(s).length > primera.split(a).length ? s : a), ",");
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c !== '"') campo += c;
      else if (texto[i + 1] === '"') { campo += '"'; i++; }
      else comillas = false;
    } else if (c === '"' && campo === "") comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim()));
}
const soloDigitos = (t) => String(t ?? "").replace(/[^0-9kK]/g, "").toLowerCase();
async function rutClientes() {
  cargando();
  // Sin la columna facturas (pesa ~90% de la tabla): se piden al hacer clic en el RUT
  const { data, error } = await sb.from("rut_clientes").select("rut, nombre, direccion, comuna, ciudad, n_facturas").order("nombre");
  const v = vista(cabecera("RUT Clientes", `<button class="primary" id="rc-cargar">Cargar CSV</button>`) + `
    <input id="rc-archivo" type="file" accept=".csv,.xlsx,.xls" hidden>
    <div class="filtros"><input id="rc-buscar" type="search" placeholder="Nombre, RUT o comuna…" aria-label="Buscar" autocomplete="off"></div>
    <p class="muted small" id="rc-conteo"></p>
    <div id="rc-res"></div>
    <dialog id="rc-dlg"><h2 id="rc-dlg-t"></h2><p class="muted small" id="rc-dlg-s"></p>
      <ul id="rc-dlg-l" style="max-height:55vh;overflow:auto;margin:8px 0 0;padding-left:20px"></ul>
      <div class="pie"><button type="button" id="rc-dlg-x">Cerrar</button></div></dialog>`, true);
  if (error) return ($("#rc-res", v).innerHTML = `<p class="vacio">${esc(msgCarga(error, "rut_clientes"))}</p>`);

  const pintar = () => {
    const q = normal($("#rc-buscar").value), qd = soloDigitos(q);
    // el RUT se compara sin puntos ni guion: "71551500" encuentra "71.551.500-8"
    const l = !q ? data : data.filter((c) => normal(`${c.nombre} ${c.comuna} ${c.ciudad} ${c.rut}`).includes(q)
      || (qd.length >= 3 && /^[0-9kK.\- ]+$/.test(q) && soloDigitos(c.rut).includes(qd)));
    $("#rc-conteo").textContent = data.length ? `${nf.format(l.length)} de ${nf.format(data.length)} clientes` : "";
    $("#rc-res").innerHTML = l.length ? `<div class="tabla-wrap"><table class="tabla">
      <thead><tr><th>RUT</th><th>Nombre</th><th>Dirección</th><th>Comuna</th><th>Ciudad</th></tr></thead>
      <tbody>${l.map((c, i) => `<tr><td style="white-space:nowrap"><button type="button" class="chico" data-i="${i}"
        title="Ver facturas asociadas">${esc(c.rut)} <span class="muted small">(${c.n_facturas ?? 0})</span></button></td><td>${esc(c.nombre)}</td>
        <td>${esc(c.direccion || "")}</td><td>${esc(c.comuna || "")}</td><td>${esc(c.ciudad || "")}</td></tr>`).join("")}</tbody>
    </table></div>` : `<p class="vacio">${data.length ? "Sin resultados." : "Todavía no hay datos. Usa “Cargar CSV”."}</p>`;
    vistos = l;
  };
  // Clic en un RUT: mini menú con sus facturas asociadas (orden numérico: Factura 2 antes que Factura 10)
  let vistos = [];
  const orden = new Intl.Collator("es", { numeric: true }), dlg = $("#rc-dlg", v);
  $("#rc-res", v).onclick = async (ev) => {
    const b = ev.target.closest("[data-i]");
    if (!b) return;
    const c = vistos[+b.dataset.i];
    b.disabled = true;
    const { data: r, error: e } = await sb.from("rut_clientes").select("facturas").eq("rut", c.rut).maybeSingle();
    b.disabled = false;
    if (e) return aviso(msgError(e), true);
    const f = [...(r?.facturas || [])].sort(orden.compare);
    $("#rc-dlg-t").textContent = c.nombre;
    $("#rc-dlg-s").textContent = `${c.rut} · ${nf.format(f.length)} factura${f.length === 1 ? "" : "s"} asociada${f.length === 1 ? "" : "s"}`;
    $("#rc-dlg-l").innerHTML = f.length ? f.map((x) => `<li>${esc(x)}</li>`).join("") : `<li class="muted">Sin facturas asociadas.</li>`;
    dlg.showModal();
  };
  $("#rc-dlg-x", v).onclick = () => dlg.close();
  // clic fuera del menú lo cierra (el borde interno del diálogo también es "el diálogo", por eso se mira la posición)
  dlg.onclick = (ev) => {
    const r = dlg.getBoundingClientRect();
    if (ev.target === dlg && (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)) dlg.close();
  };
  $("#rc-buscar", v).oninput = pintar;
  $("#rc-cargar", v).onclick = () => $("#rc-archivo", v).click();
  $("#rc-archivo", v).onchange = async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    try {
      const filas = /\.csv$/i.test(f.name) ? leerCSV(await f.text()) : (await leerArchivo(f))[0].filas;
      const { columnas, datos } = separarEncabezado(filas);
      const col = (n) => columnas.findIndex((c) => normal(c) === n);
      const idx = Object.fromEntries(["rut", "nombre", "direccion", "comuna", "ciudad", "archivo", "facturas_asociadas"].map((n) => [n, col(n)]));
      if (idx.rut < 0 || idx.nombre < 0) throw new Error("El archivo debe tener las columnas rut y nombre.");
      const items = datos.map((fila) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i < 0 || fila[i] == null ? null : String(fila[i]).trim()])))
        .filter((x) => x.rut && x.nombre)
        // facturas: la columna "archivo" más "facturas_asociadas" (separadas por " | ")
        .map(({ archivo, facturas_asociadas, ...x }) => ({ ...x, facturas: [archivo, ...String(facturas_asociadas || "").split("|")].map((t) => (t || "").trim()).filter(Boolean) }));
      if (!confirm(`¿Reemplazar la lista actual (${nf.format(data.length)}) por ${nf.format(items.length)} clientes de “${f.name}”?`)) return;
      const { data: n, error: e } = await sb.rpc("cargar_rut_clientes", { p_items: items });
      if (e) return aviso(msgError(e), true);
      aviso(`Lista cargada: ${nf.format(n)} clientes y ${nf.format(items.reduce((s, x) => s + x.facturas.length, 0))} facturas${n < items.length ? ` (${items.length - n} filas de RUT repetidos se unieron)` : ""}.`);
      rutClientes();
    } catch (e) { aviso("No se pudo leer el archivo: " + e.message, true); }
  };
  pintar();
  $("#rc-buscar", v).focus();
}

// ---------- Personal ----------
async function personal() {
  cargando();
  const [{ data, error }, perf] = await Promise.all([
    sb.from("personal").select("*").eq("empresa_id", H.empresa.id).order("nombre"),
    sb.from("perfiles").select("id, email, nombre, rol, empresa_id").in("rol", ["admin", "jefe", "operario"]).order("email"),
  ]);
  if (error) return vista(`<p class="vacio">${esc(msgError(error))}</p>`);
  // Cuentas que se pueden vincular: operarios y jefes de esta empresa, y administradores
  const cuentas = (perf.data || []).filter((u) => u.rol === "admin" || u.empresa_id === H.empresa.id);
  const tomadas = new Set(data.map((p) => p.usuario_id).filter(Boolean));
  const optCuentas = (p) => `<option value="">Sin cuenta</option>` + cuentas
    .filter((u) => u.id === p.usuario_id || !tomadas.has(u.id))
    .map((u) => `<option value="${u.id}"${u.id === p.usuario_id ? " selected" : ""}>${esc(u.nombre || u.email)}${u.rol === "admin" ? " (admin)" : ""}</option>`).join("");
  const v = vista(cabecera("Personal", empresaActiva()) + `
    <form class="panel acciones" id="form-p"><input id="p-nombre" placeholder="Nombre de la persona" style="flex:1;min-width:200px" required>
      <button class="primary" type="submit">Agregar</button></form>
    <p class="muted small">Desactivar oculta a la persona en los servicios nuevos sin perder el historial.
      <b>Cuenta</b>: si la persona también entra a Horus, vincúlala con su usuario; al registrar un servicio aparecerá marcada automáticamente.</p>
    <div class="lista">${data.map((p) => `
      <div class="tarjeta t-top" style="flex-wrap:wrap"><span>${esc(p.nombre)} ${p.activo ? "" : '<span class="chip">Inactivo</span>'}</span>
        <div class="acciones" style="margin:0">
          <select class="chico" data-cuenta="${p.id}" aria-label="Cuenta de ${esc(p.nombre)}" style="width:auto;min-height:34px;padding:4px 8px">${optCuentas(p)}</select>
          <button class="chico" data-ren="${p.id}">Renombrar</button>
          <button class="chico" data-tog="${p.id}">${p.activo ? "Desactivar" : "Activar"}</button>
          <button class="chico peligro" data-del="${p.id}">Eliminar</button></div></div>`).join("") || `<p class="vacio">Aún no hay personal.</p>`}</div>`);
  $("#form-p", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const { error: e } = await sb.from("personal").insert({ empresa_id: H.empresa.id, nombre: $("#p-nombre").value.trim() });
    if (e) return aviso(msgError(e), true);
    personal();
  };
  const buscar = (id) => data.find((x) => x.id === id);
  $$("[data-cuenta]", v).forEach((s) => (s.onchange = async () => {
    const { error: e } = await sb.from("personal").update({ usuario_id: s.value || null }).eq("id", s.dataset.cuenta);
    if (e) return aviso(e.code === "23505" ? "Esa cuenta ya está vinculada a otra persona." : msgError(e), true);
    aviso(s.value ? "Cuenta vinculada." : "Cuenta desvinculada.");
    personal();
  }));
  $$("[data-ren]", v).forEach((b) => (b.onclick = async () => {
    const p = buscar(b.dataset.ren);
    const nombre = prompt("Nuevo nombre:", p.nombre)?.trim();
    if (!nombre || nombre === p.nombre) return;
    const { error: e } = await sb.from("personal").update({ nombre }).eq("id", p.id);
    if (e) return aviso(msgError(e), true);
    personal();
  }));
  $$("[data-tog]", v).forEach((b) => (b.onclick = async () => {
    const p = buscar(b.dataset.tog);
    const { error: e } = await sb.from("personal").update({ activo: !p.activo }).eq("id", p.id);
    if (e) return aviso(msgError(e), true);
    personal();
  }));
  $$("[data-del]", v).forEach((b) => (b.onclick = async () => {
    const p = buscar(b.dataset.del);
    if (!confirm(`¿Eliminar a "${p.nombre}"? Solo se puede si no aparece en ningún servicio (si no, desactívalo).`)) return;
    const { error: e } = await sb.from("personal").delete().eq("id", p.id);
    if (e) return aviso(e.code === "23503" ? "No se puede: aparece en servicios. Desactívalo en su lugar." : msgError(e), true);
    personal();
  }));
}

// ---------- Dispositivos (sala de bombas) ----------
const UMBRALES = [
  ["temp_min", "Temperatura mínima (°C)"], ["temp_max", "Temperatura máxima (°C)"],
  ["hum_min", "Humedad mínima (%)"], ["hum_max", "Humedad máxima (%)"],
  ["pres_min", "Presión mínima (hPa)"], ["pres_max", "Presión máxima (hPa)"],
  ["margen_rocio", "Alerta condensación: T − rocío menor a (°C)"], ["offline_seg", "Desconectado si no hay datos en (s)"],
];
async function dispositivos() {
  cargando();
  const [d, cl] = await Promise.all([
    sb.from("dispositivos").select("*, clientes(nombre)").eq("empresa_id", H.empresa.id).order("nombre"),
    clientesEmpresa(),
  ]);
  if (d.error) return vista(`<p class="vacio">${esc(msgError(d.error))}</p>`);
  const optCli = (sel) => `<option value="">(sin cliente)</option>` + cl.map((c) => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.nombre)}</option>`).join("");
  const v = vista(cabecera("Sala de bombas · módulos", empresaActiva()) + `
    <form class="panel" id="form-d">
      <div class="grid2">
        <div><label for="d-id" class="req">ID del módulo (DEVICE_ID del ESP32)</label><input id="d-id" placeholder="sala-bombas-01" pattern="[a-zA-Z0-9_\\-]+" required></div>
        <div><label for="d-nombre" class="req">Nombre</label><input id="d-nombre" placeholder="Sala de bombas Planta 1" required></div>
        <div><label for="d-cli">Cliente</label><select id="d-cli">${optCli()}</select></div>
        <div><label for="d-ubic">Ubicación</label><input id="d-ubic"></div>
      </div>
      <div class="acciones" style="margin:12px 0 0"><button class="primary" type="submit">Agregar módulo</button></div>
    </form>
    <div class="lista">${d.data.map((x) => `
      <div class="tarjeta"><div class="t-top">
        <div><strong>${esc(x.nombre)}</strong> ${x.activo ? "" : '<span class="chip">Inactivo</span>'}
          <div class="muted small">${esc(x.id)} · ${esc(x.clientes?.nombre || "sin cliente")} · último dato: ${x.ultima_lectura ? fmtHora(x.ultima_lectura) : "nunca"}</div></div>
        <div class="acciones" style="margin:0">
          <a class="btn chico" href="#/sala/${encodeURIComponent(x.id)}">Ver panel</a>
          <button class="chico" data-ed="${x.id}">Editar</button>
          <button class="chico" data-clave="${x.id}">Clave ESP32</button>
          <button class="chico peligro" data-del="${x.id}">Eliminar</button></div></div></div>`).join("")
      || `<p class="vacio">No hay módulos. Agrega uno y luego define su clave.</p>`}</div>

    <dialog id="dlg-d"><form id="form-de" method="dialog">
      <h2>Editar módulo</h2>
      <label for="e-nombre" class="req">Nombre</label><input id="e-nombre" required>
      <div class="grid2"><div><label for="e-cli">Cliente</label><select id="e-cli"></select></div>
        <div><label for="e-ubic">Ubicación</label><input id="e-ubic"></div></div>
      <div class="checks" style="margin-top:12px"><label><input type="checkbox" id="e-act"> Activo (acepta datos)</label></div>
      <h2 style="margin-top:16px">Umbrales de alarma</h2>
      <div class="grid2">${UMBRALES.map(([k, l]) => `<div><label for="u-${k}">${l}</label><input id="u-${k}" type="number" step="any"></div>`).join("")}</div>
      <div class="pie"><button type="button" data-cerrar>Cancelar</button><button class="primary" type="submit">Guardar</button></div>
    </form></dialog>`);

  $("#form-d", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const id = $("#d-id").value.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return aviso("El ID solo puede tener letras, números, guiones y guion bajo.", true);
    const { error } = await sb.from("dispositivos").insert({
      id, empresa_id: H.empresa.id, nombre: $("#d-nombre").value.trim(), cliente_id: $("#d-cli").value || null, ubicacion: $("#d-ubic").value.trim() || null,
    });
    if (error) return aviso(msgError(error), true);
    aviso("Módulo agregado. Ahora define su clave (botón “Clave ESP32”).");
    dispositivos();
  };
  let editando = null;
  $("[data-cerrar]", v).onclick = () => $("#dlg-d").close();
  $$("[data-ed]", v).forEach((b) => (b.onclick = () => {
    editando = d.data.find((x) => x.id === b.dataset.ed);
    $("#e-nombre").value = editando.nombre;
    $("#e-cli").innerHTML = optCli(editando.cliente_id);
    $("#e-ubic").value = editando.ubicacion || "";
    $("#e-act").checked = editando.activo;
    for (const [k] of UMBRALES) $("#u-" + k).value = editando.umbrales?.[k] ?? "";
    $("#dlg-d").showModal();
  }));
  $("#form-de", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const umbrales = { ...editando.umbrales };
    for (const [k, l] of UMBRALES) {
      const n = Number($("#u-" + k).value);
      if ($("#u-" + k).value === "" || !Number.isFinite(n)) return aviso(`Falta un valor válido en "${l}".`, true);
      umbrales[k] = n;
    }
    const { error } = await sb.from("dispositivos").update({
      nombre: $("#e-nombre").value.trim(), cliente_id: $("#e-cli").value || null, ubicacion: $("#e-ubic").value.trim() || null,
      activo: $("#e-act").checked, umbrales,
    }).eq("id", editando.id);
    if (error) return aviso(msgError(error), true);
    $("#dlg-d").close();
    aviso("Módulo actualizado.");
    dispositivos();
  };
  $$("[data-clave]", v).forEach((b) => (b.onclick = async () => {
    const clave = prompt(`Clave para el módulo "${b.dataset.clave}" (mínimo 8 caracteres).\nDebe ser la misma que pongas en API_KEY del config.h del ESP32:`);
    if (!clave) return;
    const { error } = await sb.rpc("fijar_clave_dispositivo", { p_dispositivo: b.dataset.clave, p_clave: clave });
    if (error) return aviso(msgError(error), true);
    aviso("Clave guardada. Cópiala en el config.h del ESP32.");
  }));
  $$("[data-del]", v).forEach((b) => (b.onclick = async () => {
    if (!confirm(`¿Eliminar el módulo "${b.dataset.del}" con TODAS sus lecturas y eventos? No se puede deshacer.`)) return;
    const { error } = await sb.from("dispositivos").delete().eq("id", b.dataset.del);
    if (error) return aviso(msgError(error), true);
    aviso("Módulo eliminado.");
    dispositivos();
  }));
}

// ---------- Empresas y módulos ----------
async function empresas() {
  const v = vista(cabecera("Empresas y módulos") + `
    <p class="muted small">Los operarios de una empresa solo ven los datos de su empresa. Aquí eliges qué módulos usa cada una.</p>
    ${H.empresas.map((e) => `
      <form class="panel" data-emp="${e.id}">
        <div class="grid2">
          <div><label>Nombre</label><input class="e-nombre" value="${esc(e.nombre)}" required></div>
          <div><label>Color</label><input class="e-color" type="color" value="${esc(e.color)}" style="padding:4px"></div>
        </div>
        <label>Módulos</label>
        <div class="checks">${Object.entries(MODULOS).map(([k, m]) => `<label><input type="checkbox" value="${k}"${e.modulos.includes(k) ? " checked" : ""}>${m.titulo}</label>`).join("")}</div>
        <div class="acciones" style="margin:12px 0 0"><button class="primary" type="submit">Guardar</button></div>
      </form>`).join("")}`);
  $$("form[data-emp]", v).forEach((f) => (f.onsubmit = async (ev) => {
    ev.preventDefault();
    const cambios = { nombre: $(".e-nombre", f).value.trim(), color: $(".e-color", f).value, modulos: $$("input[type=checkbox]:checked", f).map((i) => i.value) };
    const { error } = await sb.from("empresas").update(cambios).eq("id", f.dataset.emp);
    if (error) return aviso(msgError(error), true);
    Object.assign(H.empresas.find((x) => x.id === f.dataset.emp), cambios);
    aviso("Empresa actualizada.");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }));
}

// ---------- Historial de cambios ----------
const TABLAS = {
  equipos: "Equipo", fotos_equipo: "Foto", videos_equipo: "Video", productos: "Producto", movimientos: "Movimiento",
  servicios: "Servicio", servicio_personal: "Personal del servicio", clientes: "Cliente", personal: "Personal",
  perfiles: "Usuario", dispositivos: "Módulo sala de bombas", empresas: "Empresa",
};
const ACCIONES = { INSERT: ["Creó", "ok"], UPDATE: ["Editó", "warn"], DELETE: ["Eliminó", "mal"] };
const OCULTOS = ["creado_en", "actualizado_en", "creado_por", "ultima_lectura", "id"];

async function auditoria() {
  cargando();
  const [perfiles, cls, pers] = await Promise.all([
    sb.from("perfiles").select("id, email").order("email"),
    sb.from("clientes").select("id, nombre"),
    sb.from("personal").select("id, nombre"),
  ]);
  const nombres = Object.fromEntries([...(cls.data || []), ...(pers.data || [])].map((x) => [x.id, x.nombre]));
  const valor = (k, x) => {
    if (x === null || x === undefined || x === "") return "—";
    if ((k === "cliente_id" || k === "personal_id") && nombres[x]) return nombres[x];
    if (typeof x === "boolean") return x ? "Sí" : "No";
    if (Array.isArray(x)) return x.join(", ") || "—";
    if (typeof x === "object") return JSON.stringify(x);
    return String(x);
  };
  const titulo = (a) => {
    const d = a.despues || a.antes || {};
    if (a.tabla === "servicio_personal") return `${a.accion === "INSERT" ? "Agregó a" : "Quitó a"} ${esc(valor("personal_id", d.personal_id))}`;
    return esc(d.nombre || d.email || (d.cliente_id ? valor("cliente_id", d.cliente_id) : "") || a.registro_id || "");
  };
  const detalle = (a) => {
    if (a.accion !== "UPDATE") return "";
    const ks = Object.keys(a.despues).filter((k) => !OCULTOS.includes(k) && JSON.stringify(a.antes[k]) !== JSON.stringify(a.despues[k]));
    return `<ul class="diff">${ks.map((k) => `<li>${esc(k)}: <s>${esc(valor(k, a.antes[k]))}</s> → <b>${esc(valor(k, a.despues[k]))}</b></li>`).join("")}</ul>`;
  };
  vista(cabecera("Historial de cambios") + `
    <div class="panel filtros">
      <div><label for="a-usu">Usuario</label><select id="a-usu"><option value="">Todos</option>
        ${(perfiles.data || []).map((p) => `<option value="${p.id}">${esc(p.email)}</option>`).join("")}</select></div>
      <div><label for="a-tabla">Qué</label><select id="a-tabla"><option value="">Todo</option>
        ${Object.entries(TABLAS).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
      <div><label for="a-acc">Acción</label><select id="a-acc"><option value="">Todas</option>
        ${Object.entries(ACCIONES).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
      <div><label for="a-desde">Desde</label><input type="date" id="a-desde"></div>
    </div>
    <div id="a-lista" class="lista"></div>`);
  const cargar = async () => {
    let q = sb.from("auditoria").select("*").order("fecha", { ascending: false }).limit(300);
    if ($("#a-usu").value) q = q.eq("usuario_id", $("#a-usu").value);
    if ($("#a-tabla").value) q = q.eq("tabla", $("#a-tabla").value);
    if ($("#a-acc").value) q = q.eq("accion", $("#a-acc").value);
    if ($("#a-desde").value) q = q.gte("fecha", $("#a-desde").value);
    const { data, error } = await q;
    const box = $("#a-lista");
    if (!box) return;
    if (error) return (box.innerHTML = `<p class="vacio">${esc(msgError(error))}</p>`);
    box.innerHTML = data.length ? data.map((a) => `
      <div class="tarjeta">
        <div class="t-top"><div><span class="chip ${ACCIONES[a.accion][1]}">${ACCIONES[a.accion][0]}</span> <strong>${TABLAS[a.tabla] || esc(a.tabla)}</strong></div>
          <span class="muted small">${fmtHora(a.fecha)}</span></div>
        <div class="muted small">por ${esc(a.usuario_email || "Sistema")}</div>
        <div style="margin-top:4px">${titulo(a)}</div>${detalle(a)}
      </div>`).join("") : `<p class="vacio">Sin cambios registrados.</p>`;
  };
  ["#a-usu", "#a-tabla", "#a-acc", "#a-desde"].forEach((s) => ($(s).onchange = cargar));
  cargar();
}

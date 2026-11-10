// Horus · Buscador de Excel (solo administradores)
// Los archivos se leen en este navegador y viven solo en memoria: no se suben a ningún
// servidor, no se guardan en el equipo y se olvidan al salir de la pantalla.
import { $, $$, esc, aviso, vista, nf, cargarScript, descargarCSV, alSalirDeVista } from "./nucleo.js";

export const rutas = [
  { patron: /^#\/admin\/excel$/, acceso: "admin", render: () => buscador() },
];

// Versión oficial de SheetJS (las del CDN npm están desactualizadas y tienen fallas de seguridad)
const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

// ---------- Utilidades compartidas (también las usa Lista de precios) ----------
export const normal = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Lee un archivo y devuelve sus hojas como matrices de celdas
export async function leerArchivo(file) {
  await cargarScript(SHEETJS);
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: "array", cellDates: true, dense: true });
  return wb.SheetNames.map((nombre) => ({
    nombre,
    filas: window.XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: false }),
  }));
}

// La fila de encabezados es la que tiene más textos entre las primeras 30
export function separarEncabezado(filas) {
  let mejor = 0, max = -1;
  filas.slice(0, 30).forEach((f, i) => {
    const n = f.filter((c) => typeof c === "string" && c.trim()).length;
    if (n > max) { max = n; mejor = i; }
  });
  const enc = (filas[mejor] || []).map((c, i) => (c == null || String(c).trim() === "" ? `Columna ${i + 1}` : String(c).trim()));
  // nombres repetidos → "Total", "Total (2)"
  const vistos = {};
  const columnas = enc.map((n) => (vistos[n] = (vistos[n] || 0) + 1) > 1 ? `${n} (${vistos[n]})` : n);
  const datos = filas.slice(mejor + 1).filter((f) => f.some((c) => c != null && String(c).trim() !== ""));
  return { columnas, datos };
}

// "$ 1.234.567" / "1.234,5" / 1234 → número (o null)
export function aNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).replace(/[$\s]|CLP/gi, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

// Date / "05-11-2026" / "2026-11-05" → "2026-11-05" (o null)
export function aFecha(v) {
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 12 * 3600e3); // evita el desfase de horas de Excel
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(\s|$)/);
  if (m && +m[2] <= 12 && +m[1] <= 31) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// Mes a partir del nombre del archivo: "LP_NOV2026" → "2026-11"
export function mesDeNombre(nombre) {
  const n = nombre.toUpperCase();
  const m = n.match(/(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[^A-Z0-9]?(\d{4})/);
  if (m) return `${m[2]}-${String((m[1] === "SET" ? 8 : MESES_LARGOS.indexOf(m[1])) + 1).padStart(2, "0")}`;
  const n2 = n.match(/(\d{4})[-_]?(\d{2})/);
  return n2 && +n2[2] >= 1 && +n2[2] <= 12 ? `${n2[1]}-${n2[2]}` : "";
}

const fmtFecha = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "");
const fmtMes = (ym) => `${MESES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const fmtNum = (n) => (n == null ? "" : nf.format(Math.round(n * 100) / 100));

// ---------- Pantalla ----------
async function buscador() {
  let tabla = null; // { columnas: [{n, tipo, valores?}], filas: [[...]] } — solo en memoria
  let archivos = []; // { nombre, hojas, hoja }
  alSalirDeVista(() => { tabla = null; archivos = []; });

  const v = vista(`
    <a href="#/admin" class="volver">← Administración</a>
    <h1>Buscador de Excel</h1>
    <div class="panel">
      <label class="zona-archivo" id="zona">
        <input type="file" id="x-archivo" accept=".xlsx,.xls,.xlsm,.csv,.ods" multiple>
        <strong>Elige o arrastra uno o más Excel</strong>
        <span class="muted small">Por ejemplo, las compras de varios meses: se juntan en una sola tabla.</span>
      </label>
      <p class="muted small" style="margin:10px 0 0">🔒 Los archivos se leen solo en este navegador. No se suben a internet, no se guardan
        y se borran de la memoria al salir de esta pantalla.</p>
      <div id="x-archivos"></div>
    </div>
    <div id="x-trabajo"></div>`, true);

  const input = $("#x-archivo", v), zona = $("#zona", v);
  input.onchange = () => cargar([...input.files]);
  zona.ondragover = (e) => { e.preventDefault(); zona.classList.add("encima"); };
  zona.ondragleave = () => zona.classList.remove("encima");
  zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove("encima"); cargar([...e.dataTransfer.files]); };

  async function cargar(files) {
    if (!files.length) return;
    $("#x-trabajo").innerHTML = `<p class="vacio">Leyendo ${files.length} archivo${files.length > 1 ? "s" : ""}…</p>`;
    try {
      for (const f of files) {
        const hojas = await leerArchivo(f);
        // por defecto, la hoja con más filas
        const hoja = hojas.reduce((a, h, i) => (h.filas.length > hojas[a].filas.length ? i : a), 0);
        archivos.push({ nombre: f.name, hojas, hoja });
      }
    } catch (e) {
      aviso("No se pudo leer el archivo: " + e.message, true);
    }
    input.value = "";
    pintarArchivos();
    construir();
  }

  function pintarArchivos() {
    $("#x-archivos").innerHTML = archivos.length ? `<div class="tabla-wrap" style="margin-top:12px"><table class="tabla">
      <thead><tr><th>Archivo</th><th>Hoja</th><th>Filas</th><th></th></tr></thead><tbody>
      ${archivos.map((a, i) => `<tr><td>${esc(a.nombre)}</td>
        <td>${a.hojas.length > 1 ? `<select data-hoja="${i}">${a.hojas.map((h, j) => `<option value="${j}"${j === a.hoja ? " selected" : ""}>${esc(h.nombre)}</option>`).join("")}</select>` : esc(a.hojas[0].nombre)}</td>
        <td class="num">${nf.format(a.hojas[a.hoja].filas.length)}</td>
        <td><button class="chico" data-quitar="${i}">Quitar</button></td></tr>`).join("")}
      </tbody></table></div>` : "";
    $$("[data-hoja]").forEach((s) => (s.onchange = () => { archivos[+s.dataset.hoja].hoja = +s.value; pintarArchivos(); construir(); }));
    $$("[data-quitar]").forEach((b) => (b.onclick = () => { archivos.splice(+b.dataset.quitar, 1); pintarArchivos(); construir(); }));
  }

  // Junta las hojas elegidas en una tabla y detecta el tipo de cada columna
  function construir() {
    if (!archivos.length) { tabla = null; $("#x-trabajo").innerHTML = ""; return; }
    const partes = archivos.map((a) => ({ archivo: a.nombre, ...separarEncabezado(a.hojas[a.hoja].filas) }));
    const nombres = [];
    partes.forEach((p) => p.columnas.forEach((c) => { if (!nombres.includes(c)) nombres.push(c); }));
    const variosArchivos = partes.length > 1;
    let crudas = [];
    for (const p of partes) {
      const idx = nombres.map((n) => p.columnas.indexOf(n));
      for (const f of p.datos) crudas.push([...idx.map((i) => (i < 0 ? null : f[i])), p.archivo]);
    }
    const cols = nombres.map((n, i) => {
      const vals = crudas.map((f) => f[i]).filter((x) => x != null && String(x).trim() !== "");
      const muestra = vals.slice(0, 500);
      const nF = muestra.filter((x) => aFecha(x)).length, nN = muestra.filter((x) => aNumero(x) != null).length;
      const tipo = !muestra.length ? "texto"
        : nF / muestra.length >= 0.8 && (muestra.some((x) => x instanceof Date) || nN < nF) ? "fecha"
        : nN / muestra.length >= 0.8 ? "numero" : "texto";
      // folios, códigos y números de documento se muestran tal cual (sin separador de miles)
      const crudo = tipo === "numero" && /folio|n[°º]|^nro|^num|^id\b|c[oó]d|documento|rut/i.test(n);
      return { n, tipo, crudo };
    });
    const filas = crudas.map((f) => {
      const r = cols.map((c, i) => {
        const x = f[i];
        if (x == null || String(x).trim() === "") return null;
        if (c.tipo === "fecha") return aFecha(x);
        if (c.tipo === "numero") return aNumero(x);
        return x instanceof Date ? aFecha(x) : String(x).trim();
      });
      if (variosArchivos) r.push(f[f.length - 1]);
      return r;
    });
    if (variosArchivos) cols.push({ n: "Archivo", tipo: "texto" });
    cols.forEach((c, i) => {
      if (c.tipo === "texto") c.valores = [...new Set(filas.map((f) => f[i]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    });
    tabla = { columnas: cols, filas };
    pintarTrabajo();
  }

  function pintarTrabajo() {
    const C = tabla.columnas;
    const fechas = C.map((c, i) => [c, i]).filter(([c]) => c.tipo === "fecha");
    const nums = C.map((c, i) => [c, i]).filter(([c]) => c.tipo === "numero");
    const opcCols = (lista, sel) => lista.map(([c, i]) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(c.n)}</option>`).join("");
    const todas = C.map((c, i) => [c, i]);
    // la columna de monto por defecto: la que se llama total/monto/neto, o la última numérica
    // se prueba cada patrón en orden de preferencia
    const primera = (lista, patrones) => {
      for (const re of patrones) { const x = lista.find(([c]) => re.test(c.n) && !/\brut\b/i.test(c.n)); if (x) return x[1]; }
      return undefined;
    };
    const montoDef = primera(nums, [/total/i, /monto|neto|valor/i]) ?? nums[nums.length - 1]?.[1];
    const proveedorDef = primera(todas.filter(([c]) => c.tipo === "texto"),
      [/raz[oó]n\s*social/i, /proveedor/i, /empresa|cliente|nombre/i]);

    $("#x-trabajo").innerHTML = `
      <div class="panel">
        <h2>Buscar</h2>
        <div class="filtros">
          <div style="grid-column:1/-1"><label for="x-txt">Texto (en cualquier columna)</label>
            <input id="x-txt" type="search" placeholder="Ej.: cable 2,5  ·  todas las palabras deben aparecer"></div>
          ${fechas.length ? `
          <div><label for="x-fcol">Columna de fecha</label><select id="x-fcol">${opcCols(fechas, fechas[0][1])}</select></div>
          <div><label for="x-mes">Mes</label><select id="x-mes"></select></div>
          <div><label for="x-desde">Desde</label><input type="date" id="x-desde"></div>
          <div><label for="x-hasta">Hasta</label><input type="date" id="x-hasta"></div>` : ""}
        </div>
        <div id="x-condiciones"></div>
        <button class="chico" id="x-mas">+ Agregar condición</button>
        <button class="chico ghost" id="x-limpiar">Limpiar filtros</button>
        <datalist id="x-valores"></datalist>
      </div>
      <div class="panel">
        <h2>Resumen</h2>
        <div class="filtros">
          <div><label for="x-grupo">Agrupar por</label><select id="x-grupo"><option value="">— No agrupar —</option>
            ${fechas.map(([c, i]) => `<option value="mes:${i}">Mes (${esc(c.n)})</option>`).join("")}
            ${todas.filter(([c]) => c.tipo === "texto").map(([c, i]) => `<option value="${i}">${esc(c.n)}</option>`).join("")}</select></div>
          ${nums.length ? `<div><label for="x-suma">Sumar</label><select id="x-suma">${opcCols(nums, montoDef)}</select></div>` : ""}
        </div>
        <div id="x-resumen"></div>
      </div>
      <div class="acciones"><span class="muted small" id="x-conteo" style="flex:1"></span>
        <button id="x-csv">Exportar resultado (CSV)</button></div>
      <div id="x-tabla"></div>`;

    const condiciones = [];
    let orden = null, mostrar = 200;

    const pintarCondiciones = () => {
      $("#x-condiciones").innerHTML = condiciones.map((k, j) => {
        const c = C[k.col];
        const ops = c.tipo === "numero" ? [["=", "="], [">=", "≥"], ["<=", "≤"]]
          : c.tipo === "fecha" ? [["desde", "desde"], ["hasta", "hasta"]]
          : [["contiene", "contiene"], ["igual", "es igual a"], ["no", "no contiene"]];
        return `<div class="condicion">
          <select data-c="${j}" data-k="col">${opcCols(todas, k.col)}</select>
          <select data-c="${j}" data-k="op">${ops.map(([o, t]) => `<option value="${o}"${o === k.op ? " selected" : ""}>${t}</option>`).join("")}</select>
          <input data-c="${j}" data-k="val" value="${esc(k.val)}" ${c.tipo === "fecha" ? 'type="date"' : c.tipo === "numero" ? 'inputmode="decimal"' : 'list="x-valores"'}>
          <button class="chico ghost" data-borrar-c="${j}" aria-label="Quitar condición">✕</button></div>`;
      }).join("");
      $$("#x-condiciones [data-c]").forEach((el) => {
        const j = +el.dataset.c, k = el.dataset.k;
        el.onfocus = () => { if (k === "val") $("#x-valores").innerHTML = (C[condiciones[j].col].valores || []).slice(0, 500).map((x) => `<option value="${esc(x)}">`).join(""); };
        const cambiar = () => {
          condiciones[j][k] = k === "col" ? +el.value : el.value;
          if (k === "col") { condiciones[j].op = C[+el.value].tipo === "numero" ? "=" : C[+el.value].tipo === "fecha" ? "desde" : "contiene"; condiciones[j].val = ""; pintarCondiciones(); }
          aplicar();
        };
        el.oninput = k === "val" ? cambiar : null;
        el.onchange = cambiar;
      });
      $$("[data-borrar-c]").forEach((b) => (b.onclick = () => { condiciones.splice(+b.dataset.borrarC, 1); pintarCondiciones(); aplicar(); }));
    };
    $("#x-mas").onclick = () => {
      const col = proveedorDef ?? 0;
      condiciones.push({ col, op: C[col].tipo === "numero" ? "=" : C[col].tipo === "fecha" ? "desde" : "contiene", val: "" });
      pintarCondiciones();
      $$("#x-condiciones [data-k=val]").pop()?.focus();
    };
    $("#x-limpiar").onclick = () => {
      condiciones.length = 0; pintarCondiciones();
      ["#x-txt", "#x-desde", "#x-hasta"].forEach((s) => $(s) && ($(s).value = ""));
      if ($("#x-mes")) $("#x-mes").value = "";
      aplicar();
    };

    const llenarMeses = () => {
      if (!$("#x-fcol")) return;
      const i = +$("#x-fcol").value;
      const meses = [...new Set(tabla.filas.map((f) => f[i]?.slice(0, 7)).filter(Boolean))].sort().reverse();
      $("#x-mes").innerHTML = `<option value="">Todos</option>` + meses.map((m) => `<option value="${m}">${fmtMes(m)}</option>`).join("");
    };
    llenarMeses();

    let filtradas = [];
    function aplicar() {
      const palabras = normal($("#x-txt").value).split(/\s+/).filter(Boolean);
      const fi = $("#x-fcol") ? +$("#x-fcol").value : -1;
      const mes = $("#x-mes")?.value, desde = $("#x-desde")?.value, hasta = $("#x-hasta")?.value;
      const conds = condiciones.filter((k) => String(k.val).trim() !== "").map((k) => ({
        ...k, tipo: C[k.col].tipo, n: aNumero(k.val), t: normal(k.val),
      }));
      filtradas = tabla.filas.filter((f) => {
        if (fi >= 0) {
          const d = f[fi];
          if (mes && (!d || d.slice(0, 7) !== mes)) return false;
          if (desde && (!d || d < desde)) return false;
          if (hasta && (!d || d > hasta)) return false;
        }
        for (const k of conds) {
          const x = f[k.col];
          if (k.tipo === "numero") {
            if (x == null || k.n == null) return false;
            if (k.op === "=" && x !== k.n) return false;
            if (k.op === ">=" && x < k.n) return false;
            if (k.op === "<=" && x > k.n) return false;
          } else if (k.tipo === "fecha") {
            if (!x || (k.op === "desde" ? x < k.val : x > k.val)) return false;
          } else {
            const t = normal(x);
            if (k.op === "contiene" && !t.includes(k.t)) return false;
            if (k.op === "igual" && t !== k.t) return false;
            if (k.op === "no" && t.includes(k.t)) return false;
          }
        }
        if (palabras.length) {
          const t = normal(f.join(" "));
          if (!palabras.every((p) => t.includes(p))) return false;
        }
        return true;
      });
      if (orden) {
        const { i, dir } = orden;
        filtradas.sort((a, b) => (a[i] == null) - (b[i] == null) || (a[i] < b[i] ? -dir : a[i] > b[i] ? dir : 0));
      }
      mostrar = 200;
      pintarResumen();
      pintarTabla();
    }

    function pintarResumen() {
      const g = $("#x-grupo").value, si = $("#x-suma") ? +$("#x-suma").value : -1;
      const totalSuma = si >= 0 ? filtradas.reduce((s, f) => s + (f[si] || 0), 0) : 0;
      let html = `<div class="kpis"><div><span class="muted small">Filas</span><strong>${nf.format(filtradas.length)}</strong></div>
        ${si >= 0 ? `<div><span class="muted small">Suma de ${esc(C[si].n)}</span><strong>${fmtNum(totalSuma)}</strong></div>` : ""}</div>`;
      if (g) {
        const mesCol = g.startsWith("mes:"), gi = mesCol ? +g.slice(4) : +g;
        const grupos = new Map();
        for (const f of filtradas) {
          const clave = mesCol ? f[gi]?.slice(0, 7) || "(sin fecha)" : f[gi] ?? "(vacío)";
          const r = grupos.get(clave) || { n: 0, s: 0 };
          r.n++; if (si >= 0) r.s += f[si] || 0;
          grupos.set(clave, r);
        }
        const filasG = [...grupos].sort((a, b) => (mesCol ? (a[0] < b[0] ? 1 : -1) : b[1].s - a[1].s || b[1].n - a[1].n));
        html += `<div class="tabla-wrap" style="max-height:360px;overflow:auto;margin-top:10px"><table class="tabla">
          <thead><tr><th>${mesCol ? "Mes" : esc(C[gi].n)}</th><th class="num">Filas</th>${si >= 0 ? `<th class="num">Suma</th><th class="num">%</th>` : ""}</tr></thead>
          <tbody>${filasG.map(([k, r]) => `<tr><td>${esc(mesCol && k !== "(sin fecha)" ? fmtMes(k) : k)}</td><td class="num">${nf.format(r.n)}</td>
            ${si >= 0 ? `<td class="num">${fmtNum(r.s)}</td><td class="num">${totalSuma ? nf.format(Math.round((r.s / totalSuma) * 1000) / 10) : 0}%</td>` : ""}</tr>`).join("")}
          </tbody></table></div>`;
      }
      $("#x-resumen").innerHTML = html;
    }

    function pintarTabla() {
      $("#x-conteo").textContent = `${nf.format(filtradas.length)} de ${nf.format(tabla.filas.length)} filas`;
      const celda = (c, x) => (x == null ? "" : c.tipo === "fecha" ? fmtFecha(x) : c.tipo === "numero" ? (c.crudo ? String(x) : fmtNum(x)) : esc(x));
      $("#x-tabla").innerHTML = filtradas.length ? `<div class="tabla-wrap"><table class="tabla tabla-excel">
        <thead><tr>${C.map((c, i) => `<th data-orden="${i}" class="${c.tipo === "numero" ? "num" : ""}" title="Ordenar">${esc(c.n)}${orden?.i === i ? (orden.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
        <tbody>${filtradas.slice(0, mostrar).map((f) => `<tr>${C.map((c, i) => `<td class="${c.tipo === "numero" ? "num" : ""}">${celda(c, f[i])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      ${filtradas.length > mostrar ? `<div class="acciones" style="justify-content:center;margin-top:10px"><button id="x-ver-mas">Mostrar ${nf.format(Math.min(500, filtradas.length - mostrar))} más</button></div>` : ""}`
        : `<p class="vacio">Ninguna fila coincide con los filtros.</p>`;
      $$("#x-tabla [data-orden]").forEach((th) => (th.onclick = () => {
        const i = +th.dataset.orden;
        orden = orden?.i === i ? (orden.dir > 0 ? { i, dir: -1 } : null) : { i, dir: 1 };
        aplicar();
      }));
      const mas = $("#x-ver-mas");
      if (mas) mas.onclick = () => { mostrar += 500; pintarTabla(); };
    }

    let t;
    $("#x-txt").oninput = () => { clearTimeout(t); t = setTimeout(aplicar, 200); };
    ["#x-mes", "#x-desde", "#x-hasta"].forEach((s) => $(s) && ($(s).onchange = aplicar));
    if ($("#x-fcol")) $("#x-fcol").onchange = () => { llenarMeses(); aplicar(); };
    $("#x-grupo").onchange = pintarResumen;
    if ($("#x-suma")) $("#x-suma").onchange = pintarResumen;
    $("#x-csv").onclick = () => descargarCSV("busqueda", C.map((c) => c.n),
      filtradas.map((f) => C.map((c, i) => (c.tipo === "fecha" ? fmtFecha(f[i]) : f[i]))));
    aplicar();
  }
}

// Horus · Sala de bombas: monitoreo ESP32 (temperatura, humedad, presión, movimiento)
import {
  sb, H, $, esc, aviso, msgError, vista, cargando, alSalirDeVista, fmtHora, descargarCSV,
  cargarScript, SCRIPTS, esCliente,
} from "./nucleo.js";

export const rutas = [
  { patron: /^#\/sala$/, modulo: "sala_bombas", render: () => lista() },
  { patron: /^#\/sala\/([^/]+)$/, modulo: "sala_bombas", render: (id) => panel(id) },
];

const enLinea = (d) => d.ultima_lectura && Date.now() - new Date(d.ultima_lectura) < (d.umbrales?.offline_seg || 60) * 1000;
const hace = (iso) => {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : fmtHora(iso);
};

async function dispositivos() {
  let q = sb.from("dispositivos").select("*, clientes(nombre)").eq("activo", true).order("nombre");
  if (!esCliente()) q = q.eq("empresa_id", H.empresa.id);
  const { data, error } = await q;
  if (error) { aviso(msgError(error), true); return null; }
  return data;
}

async function lista() {
  cargando();
  const ds = await dispositivos();
  if (!ds) return;
  if (ds.length === 1) { location.replace("#/sala/" + encodeURIComponent(ds[0].id)); return; }
  vista(`<h1>Sala de bombas</h1><div class="lista">
    ${ds.length ? ds.map((d) => `
      <a class="tarjeta" href="#/sala/${encodeURIComponent(d.id)}">
        <div class="t-top"><strong>${esc(d.nombre)}</strong>
          <span class="chip ${enLinea(d) ? "ok" : "mal"}">${enLinea(d) ? "En línea" : "Desconectado"}</span></div>
        <div class="muted small">${esc(d.clientes?.nombre || "")}${d.ubicacion ? " · " + esc(d.ubicacion) : ""} · ${esc(d.id)}</div>
        <div class="muted small">Último dato: ${d.ultima_lectura ? hace(d.ultima_lectura) : "nunca"}</div>
      </a>`).join("")
      : `<p class="vacio">${esCliente() ? "No tienes una sala de bombas monitoreada." : "No hay módulos de sala de bombas registrados."}</p>`}
  </div>`);
}

function alarmas(l, u) {
  const a = [];
  if (!l) return a;
  if (l.temperatura != null && l.temperatura > u.temp_max) a.push(["temp", `Temperatura alta: ${l.temperatura} °C`]);
  if (l.temperatura != null && l.temperatura < u.temp_min) a.push(["temp", `Temperatura baja: ${l.temperatura} °C`]);
  if (l.humedad != null && l.humedad > u.hum_max) a.push(["hum", `Humedad alta: ${l.humedad} %`]);
  if (l.humedad != null && l.humedad < u.hum_min) a.push(["hum", `Humedad baja: ${l.humedad} %`]);
  if (l.presion != null && (l.presion > u.pres_max || l.presion < u.pres_min)) a.push(["pres", `Presión fuera de rango: ${l.presion} hPa`]);
  if (l.temperatura != null && l.punto_rocio != null && l.temperatura - l.punto_rocio < u.margen_rocio)
    a.push(["hum", `Riesgo de condensación (T ${l.temperatura} °C, rocío ${l.punto_rocio} °C)`]);
  if (l.errores?.length) a.push(["sensor", `Sensor sin respuesta: ${l.errores.join(", ")}`]);
  return a;
}

async function panel(id) {
  cargando();
  const { data: d, error } = await sb.from("dispositivos").select("*, clientes(nombre)").eq("id", id).maybeSingle();
  if (error || !d) { vista(`<a href="#/sala" class="volver">← Sala de bombas</a><p class="vacio">No se encontró el módulo.</p>`); return; }
  const v = vista(`
    <a href="#/sala" class="volver">← Sala de bombas</a>
    <div class="cabecera" style="margin-bottom:12px">
      <div><h1 style="margin:0">${esc(d.nombre)}</h1>
        <div class="muted small">${esc(d.clientes?.nombre || "")}${d.ubicacion ? " · " + esc(d.ubicacion) : ""} · ${esc(d.id)}</div></div>
      <div class="chip" id="estado"><span class="punto"></span> Esperando datos…</div>
    </div>
    <div class="alarmas" id="alarmas" hidden></div>
    <section class="sensores">
      <div class="sensor" id="c-temp"><div class="etq">Temperatura</div><div class="valor" id="v-temp">--</div><div class="extra" id="x-temp">DHT22</div></div>
      <div class="sensor" id="c-hum"><div class="etq">Humedad relativa</div><div class="valor" id="v-hum">--</div><div class="extra" id="x-hum">Punto de rocío --</div></div>
      <div class="sensor" id="c-pres"><div class="etq">Presión atmosférica</div><div class="valor" id="v-pres">--</div><div class="extra">BMP280</div></div>
      <div class="sensor"><div class="etq">Movimiento (PIR)</div><div class="valor" id="v-mov">--</div><div class="extra" id="x-mov">Último: --</div></div>
    </section>
    <section class="sala-fila">
      <div class="panel" style="margin:0">
        <div class="cabecera" style="margin-bottom:10px"><h2 style="margin:0">Historial</h2>
          <div class="acciones" style="margin:0">
            <select id="rango" style="width:auto">
              <option value="1">Última hora</option><option value="6">6 horas</option>
              <option value="24" selected>24 horas</option><option value="168">7 días</option><option value="720">30 días</option>
            </select>
            <button id="btn-csv" class="chico">Exportar CSV</button>
          </div></div>
        <div class="graf"><canvas id="g-th"></canvas></div>
        <div class="graf"><canvas id="g-p"></canvas></div>
      </div>
      <div class="panel" style="margin:0"><h2>Eventos</h2><ul class="eventos" id="eventos"><li class="vacio">Sin eventos</li></ul></div>
    </section>`, true);

  const u = d.umbrales || {};
  let graficos = null;
  try {
    await cargarScript(SCRIPTS.chart);
    const css = (x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim();
    const Chart = window.Chart;
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--line");
    const ejeX = { ticks: { maxTicksLimit: innerWidth < 600 ? 4 : 8, maxRotation: 0 } };
    const linea = (label, color, eje) => ({ label, data: [], borderColor: color, backgroundColor: color, yAxisID: eje, tension: .3, pointRadius: 0, borderWidth: 2 });
    graficos = {
      th: new Chart($("#g-th", v), {
        type: "line",
        data: { labels: [], datasets: [linea("Temperatura °C", css("--temp"), "y"), linea("Humedad %", css("--hum"), "y1")] },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
          scales: { x: ejeX, y: { position: "left", title: { display: true, text: "°C" } },
            y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "%" } } } },
      }),
      p: new Chart($("#g-p", v), {
        type: "line",
        data: { labels: [], datasets: [linea("Presión hPa", css("--pres"), "y")] },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, scales: { x: ejeX } },
      }),
    };
  } catch { aviso("No se pudieron cargar los gráficos (¿sin internet?).", true); }

  async function estado() {
    const [l, m, dd] = await Promise.all([
      sb.from("lecturas").select("*").eq("dispositivo_id", id).order("ts", { ascending: false }).limit(1).maybeSingle(),
      sb.from("eventos_sala").select("ts").eq("dispositivo_id", id).eq("tipo", "movimiento").order("ts", { ascending: false }).limit(1).maybeSingle(),
      sb.from("dispositivos").select("ultima_lectura, umbrales").eq("id", id).maybeSingle(),
    ]);
    if (!$("#estado")) return;
    const x = l.data;
    const online = dd.data && enLinea({ ...d, ...dd.data });
    $("#estado").className = "chip " + (x ? (online ? "ok" : "mal") : "");
    $("#estado").innerHTML = !x ? "Sin datos todavía"
      : online ? `<span class="punto ok"></span> En línea · ${hace(x.ts)}${x.rssi != null ? ` · WiFi ${x.rssi} dBm` : ""}`
      : `<span class="punto mal"></span> DESCONECTADO · último dato ${hace(x.ts)}`;
    const val = (n, un) => (n == null ? `--<small> ${un}</small>` : `${Number(n).toFixed(1).replace(".", ",")}<small> ${un}</small>`);
    $("#v-temp").innerHTML = val(x?.temperatura, "°C");
    $("#x-temp").textContent = x?.temperatura_bmp != null ? `DHT22 · BMP280: ${x.temperatura_bmp} °C` : "DHT22";
    $("#v-hum").innerHTML = val(x?.humedad, "%");
    $("#x-hum").textContent = `Punto de rocío ${x?.punto_rocio ?? "--"} °C`;
    $("#v-pres").innerHTML = val(x?.presion, "hPa");
    if (x?.pir_calentando) { $("#v-mov").textContent = "Calentando"; $("#v-mov").style.color = ""; }
    else if (x) { $("#v-mov").textContent = x.movimiento ? "Detectado" : "Sin movimiento"; $("#v-mov").style.color = x.movimiento ? "var(--bad)" : "var(--ok)"; }
    $("#x-mov").textContent = "Último: " + (m.data ? fmtHora(m.data.ts) : "--");
    const al = alarmas(x, dd.data?.umbrales || u);
    const tipos = al.map((a) => a[0]);
    $("#c-temp").classList.toggle("alarma", tipos.includes("temp"));
    $("#c-hum").classList.toggle("alarma", tipos.includes("hum"));
    $("#c-pres").classList.toggle("alarma", tipos.includes("pres"));
    const items = al.map((a) => "• " + esc(a[1]));
    if (x && !online) items.unshift("• El módulo no está enviando datos");
    $("#alarmas").hidden = !items.length;
    $("#alarmas").innerHTML = `<b>Alarmas activas</b><br>${items.join("<br>")}`;
  }

  async function historial() {
    if (!graficos) return;
    const horas = Number($("#rango").value);
    const { data, error: e } = await sb.rpc("historial_sala", { p_dispositivo: id, p_horas: horas });
    if (e || !$("#g-th")) return;
    const etq = data.map((f) => new Date(f.ts).toLocaleString("es-CL",
      horas > 24 ? { day: "2-digit", month: "2-digit", hour: "2-digit", hour12: false } : { hour: "2-digit", minute: "2-digit", hour12: false }));
    graficos.th.data.labels = etq; graficos.p.data.labels = etq;
    graficos.th.data.datasets[0].data = data.map((f) => f.temperatura);
    graficos.th.data.datasets[1].data = data.map((f) => f.humedad);
    graficos.p.data.datasets[0].data = data.map((f) => f.presion);
    graficos.th.update("none"); graficos.p.update("none");
  }

  async function eventos() {
    const { data } = await sb.from("eventos_sala").select("*").eq("dispositivo_id", id).order("ts", { ascending: false }).limit(60);
    if (!$("#eventos")) return;
    $("#eventos").innerHTML = data?.length ? data.map((e) => `<li><time>${fmtHora(e.ts)}</time>
      <span class="chip ${e.tipo === "movimiento" ? "warn" : "mal"}" style="font-size:11px">${esc(e.tipo)}</span> ${esc(e.detalle)}</li>`).join("")
      : `<li class="vacio">Sin eventos</li>`;
  }

  async function exportar() {
    const horas = Number($("#rango").value);
    const desde = new Date(Date.now() - horas * 3600e3).toISOString();
    const filas = [];
    aviso("Preparando CSV…");
    for (let i = 0; i < 100; i++) { // en bloques de 1000 (límite de Supabase)
      const { data, error: e } = await sb.from("lecturas").select("ts,temperatura,humedad,punto_rocio,presion,movimiento,rssi")
        .eq("dispositivo_id", id).gte("ts", desde).order("ts").range(i * 1000, i * 1000 + 999);
      if (e) return aviso(msgError(e), true);
      filas.push(...data);
      if (data.length < 1000) break;
    }
    descargarCSV(`sala-${id}-${horas}h`, ["Fecha", "Temperatura", "Humedad", "Punto de rocío", "Presión", "Movimiento", "RSSI"],
      filas.map((f) => [fmtHora(f.ts), f.temperatura, f.humedad, f.punto_rocio, f.presion, f.movimiento ? 1 : 0, f.rssi]));
  }

  $("#rango", v).onchange = historial;
  $("#btn-csv", v).onclick = exportar;
  estado(); historial(); eventos();
  const timers = [setInterval(estado, 5000), setInterval(eventos, 15000), setInterval(historial, 60000)];
  alSalirDeVista(() => {
    timers.forEach(clearInterval);
    if (graficos) { graficos.th.destroy(); graficos.p.destroy(); }
  });
}

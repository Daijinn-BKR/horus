// Horus · fotos y videos (Equipos y Órdenes de trabajo): preparar, subir, mostrar y borrar.
// Cada módulo indica su bucket, su carpeta y cómo guardar/borrar la fila que registra el archivo.
import { sb, esc, aviso, msgError } from "./nucleo.js";

export const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB, límite del plan gratis
const TIPOS_VIDEO = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  "3gp": "video/3gpp", mkv: "video/x-matroska", avi: "video/x-msvideo" };
const TIPOS_FOTO = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif" };

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

// Muchos celulares graban en HEVC (H.265), que Chrome no reproduce en PC sin soporte en la tarjeta de video
// (se ve negro). Si el navegador puede, se convierte a H.264, que se ve en todos. Si no, se sube tal cual.
async function aH264(file) {
  if (!window.VideoEncoder) return file;
  try {
    const M = await import("./vendor/mediabunny-1.65.0.min.mjs");
    const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack();
    if (!v || v.codec === "avc") return file;
    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: "in-memory" }), target: new M.BufferTarget() });
    const conv = await M.Conversion.init({ input, output, video: { codec: "avc", bitrate: M.QUALITY_MEDIUM } });
    if (!conv.isValid || conv.discardedTracks.length) return file; // nunca perder el video ni el sonido
    conv.onProgress = (p) => aviso(`Convirtiendo “${file.name}” para que se vea en todos los navegadores… ${Math.round(p * 100)} %`);
    await conv.execute();
    return new Blob([output.target.buffer], { type: "video/mp4" });
  } catch (e) {
    console.warn("No se pudo convertir el video, se sube el original:", e);
    return file;
  }
}

// Decide si es foto o video y lo deja listo para subir. Los buckets solo aceptan los tipos de TIPOS_FOTO
// y TIPOS_VIDEO (no SVG, que puede traer código); el tipo se completa por la extensión si el celular no lo informa.
const tipoValido = (lista, t) => (Object.values(lista).includes(t) ? t : null);
async function preparar(file, tipo) {
  const ext = (file.name.includes(".") ? file.name.split(".").pop() : "").toLowerCase();
  tipo ||= file.type.startsWith("video/") || TIPOS_VIDEO[ext] ? "video" : "foto";
  if (tipo === "video") {
    const contentType = tipoValido(TIPOS_VIDEO, file.type) || TIPOS_VIDEO[ext];
    if (!contentType) throw new Error(`“${file.name}” no es un video.`);
    const blob = await aH264(file);
    if (blob.size > MAX_VIDEO) throw new Error(`“${file.name}” pesa más de 50 MB. Grábalo más corto o en menor calidad.`);
    if (blob !== file) return { tipo, blob, ext: "mp4", contentType: "video/mp4" };
    return { tipo, blob: file, ext: ext || "mp4", contentType };
  }
  const blob = await reducirImagen(file);
  if (blob !== file) return { tipo, blob, ext: "jpg", contentType: "image/jpeg" };
  const contentType = tipoValido(TIPOS_FOTO, file.type) || TIPOS_FOTO[ext];
  if (!contentType) throw new Error(`“${file.name}” no es una foto (usa JPG, PNG, WEBP, GIF o HEIC).`);
  return { tipo, blob: file, ext: ext || "jpg", contentType };
}

// Sube los archivos a <bucket>/<carpeta>/<uuid>.<ext>. registrar(ruta, tipo) guarda la fila y devuelve { error }.
// Si la fila no se pudo guardar, se borra el archivo (quien lo subió puede borrar sus archivos sin registro).
export async function subirMedios({ bucket, carpeta, files, tipo, registrar }) {
  const lista = [...(files || [])];
  let ok = 0;
  for (let i = 0; i < lista.length; i++) {
    aviso(`Subiendo archivo ${i + 1} de ${lista.length}…`);
    let a;
    try { a = await preparar(lista[i], tipo); } catch (e) { aviso(e.message, true); continue; }
    const ruta = `${carpeta}/${crypto.randomUUID()}.${a.ext}`;
    const up = await sb.storage.from(bucket).upload(ruta, a.blob, { contentType: a.contentType });
    if (up.error) { aviso("No se pudo subir: " + msgError(up.error), true); continue; }
    const ins = await registrar(ruta, a.tipo);
    if (ins.error) {
      await sb.storage.from(bucket).remove([ruta]);
      aviso("No se pudo guardar: " + msgError(ins.error), true);
      continue;
    }
    ok++;
  }
  if (ok) aviso(ok === 1 ? "Archivo subido." : `${ok} archivos subidos.`);
  return ok;
}

// Pinta las fotos en cf y los videos en cv. items: [{ ruta, tipo, ... }].
// puedeQuitar(x) muestra la ✕; alQuitar(x) se llama al tocarla.
export async function pintarMedios({ bucket, items, cf, cv, alt, vacioFotos = "", vacioVideos = "", puedeQuitar, alQuitar }) {
  const firmadas = {};
  if (items.length) {
    const { data, error } = await sb.storage.from(bucket).createSignedUrls(items.map((x) => x.ruta), 3600);
    if (!error) data.forEach((d) => { if (d.signedUrl) firmadas[d.path] = d.signedUrl; });
  }
  if (!cf.isConnected) return; // el usuario cambió de pantalla
  const url = (x) => esc(firmadas[x.ruta] || "");
  const quitar = (x, i) => (puedeQuitar(x)
    ? `<button type="button" class="quitar" data-i="${i}" aria-label="Borrar ${x.tipo}">✕</button>` : "");
  const html = (tipo, fn, vacio) => {
    const l = items.map((x, i) => [x, i]).filter(([x]) => x.tipo === tipo);
    return l.length ? l.map(([x, i]) => fn(x, i)).join("") : vacio ? `<p class="muted small" style="grid-column:1/-1;margin:0">${esc(vacio)}</p>` : "";
  };
  cf.innerHTML = html("foto", (x, i) => `<figure><a href="${url(x) || "#"}" target="_blank" rel="noopener">
    <img loading="lazy" src="${url(x)}" alt="${esc(alt)}"></a>${quitar(x, i)}</figure>`, vacioFotos);
  cv.innerHTML = html("video", (x, i) => `<figure><video controls preload="metadata" playsinline src="${url(x)}"></video>${quitar(x, i)}</figure>`, vacioVideos);
  for (const b of [...cf.querySelectorAll(".quitar"), ...cv.querySelectorAll(".quitar")]) b.onclick = () => alQuitar(items[+b.dataset.i]);
}

// Borra el archivo y después su fila (el permiso del archivo se revisa contra la fila, por eso va primero).
// borrarFila() debe devolver las filas borradas (.delete()...select("id")): si no borró ninguna, no había permiso.
export async function borrarMedio(bucket, x, borrarFila) {
  if (!confirm(x.tipo === "video" ? "¿Borrar este video?" : "¿Borrar esta foto?")) return false;
  const st = await sb.storage.from(bucket).remove([x.ruta]);
  if (st.error) { aviso(msgError(st.error), true); return false; }
  const { data, error } = await borrarFila();
  if (error) { aviso(msgError(error), true); return false; }
  if (!data?.length) { aviso("No tienes permiso para borrar este archivo.", true); return false; }
  aviso("Borrado.");
  return true;
}

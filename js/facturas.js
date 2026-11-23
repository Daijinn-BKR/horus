// Horus · lectura de facturas electrónicas (PDF) para RUT Clientes.
// Mismas reglas que extraer.py (pdftotext -layout): se rearma el texto con sus columnas y se buscan
// los datos del receptor (bloque "SEÑOR(ES):"), la fecha de emisión y el total.
// Sin dependencias: recibe la librería pdf.js ya cargada, para poder probarlo fuera del navegador.

// Texto de una página con las columnas en su lugar (como pdftotext -layout)
export function textoConColumnas(items) {
  const t = items.filter((i) => i.str && i.str.trim()).map((i) => ({
    s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || Math.abs(i.transform[0]) || 10,
  }));
  if (!t.length) return "";
  const anchos = t.filter((i) => i.s.length > 2).map((i) => i.w / i.s.length).sort((a, b) => a - b);
  const cw = anchos.length ? anchos[Math.floor(anchos.length / 2)] : 5; // ancho de una letra (mediana)
  const x0 = Math.min(...t.map((i) => i.x));
  const lineas = [];
  for (const i of [...t].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const l = lineas.find((l) => Math.abs(l.y - i.y) < Math.min(l.h, i.h) * 0.5);
    if (l) l.items.push(i); else lineas.push({ y: i.y, h: i.h, items: [i] });
  }
  return lineas.sort((a, b) => b.y - a.y).map((l) => {
    let s = "", fin = -Infinity;
    for (const i of l.items.sort((a, b) => a.x - b.x)) {
      const col = Math.round((i.x - x0) / cw);
      if (s.length < col) s = s.padEnd(col);
      else if (s && i.x - fin > cw * 0.3 && !s.endsWith(" ")) s += " ";
      s += i.s;
      fin = i.x + i.w;
    }
    return s.trimEnd();
  }).join("\n");
}

const PATRONES = {
  nombre: /SEÑOR\(ES\):\s*(.+?)(?:\s{2,}|$)/m,
  rut: /SEÑOR\(ES\):.*?R\.U\.T\.:\s*([\d.]+\s*-\s*[\dkK])/s,
  direccion: /DIRECCION:\s*(.+?)(?:\s{2,}|$)/m,
  comuna: /COMUNA\s+(.+?)\s+CIUDAD:/m,
  ciudad: /CIUDAD:\s*(.+?)\s*$/m,
  fecha: /Fecha Emision:\s*(.+?)(?:\s{2,}|$)/m,
  total: /^\s+TOTAL\s+\$\s*([\d.]+)/m,
};

// Nombres largos se parten en la línea de arriba y la de abajo de "SEÑOR(ES):", en la columna izquierda
function nombreCompleto(texto) {
  const lineas = texto.split("\n");
  const sangria = (l) => l.search(/\S/);
  const i = lineas.findIndex((l) => l.trimStart().startsWith("SEÑOR(ES):"));
  if (i < 0) return "";
  // El nombre partido empieza en la misma columna que el valor del R.U.T.; otras columnas (Teléfono, Fecha)
  // empiezan más a la derecha
  const base = sangria(lineas[i]);
  const rut = lineas.slice(i + 1).find((l) => l.trimStart().startsWith("R.U.T.:")) || "";
  const valor = rut ? rut.indexOf(":") + 1 + sangria(rut.slice(rut.indexOf(":") + 1)) : base + 15;
  const izquierda = (l) => sangria(l) > base && sangria(l) <= valor + 3;
  const partes = i > 0 && izquierda(lineas[i - 1]) ? [lineas[i - 1]] : [];
  partes.push(lineas[i].trimStart().slice("SEÑOR(ES):".length));
  for (const l of lineas.slice(i + 1)) {
    if (!izquierda(l)) break;
    partes.push(l);
  }
  // Solo el primer bloque de cada línea; lo que viene tras 2+ espacios es otra columna
  return partes.map((p) => p.trim().split(/\s{2,}|\s*(?:Fecha Emision|TIPO DE VENTA):/)[0]).filter(Boolean).join(" ");
}

// Datos de una factura a partir de su texto. Devuelve también qué campos no se encontraron.
export function datosFactura(texto) {
  const d = {};
  for (const [k, re] of Object.entries(PATRONES)) d[k] = (texto.match(re)?.[1] || "").trim();
  d.rut = d.rut.replace(/\s+/g, "").toUpperCase();
  d.nombre = nombreCompleto(texto) || d.nombre;
  d.faltan = Object.keys(PATRONES).filter((k) => !d[k]);
  return d;
}

// Lee un PDF completo (todas sus páginas) con pdf.js
export async function leerFactura(pdfjsLib, datos) {
  const pdf = await pdfjsLib.getDocument({ data: datos, isEvalSupported: false }).promise;
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) paginas.push(textoConColumnas((await (await pdf.getPage(n)).getTextContent()).items));
  await pdf.destroy();
  return datosFactura(paginas.join("\n"));
}

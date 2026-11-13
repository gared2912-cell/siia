// Gráficas del estado financiero mensual en SVG (ingresos vs. egresos y distribución de egresos), su conversión a PNG
// y el logotipo en base64. Las usan el Excel del panel y el estado financiero que ven los residentes.

export const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function compacto(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)} M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}
function escalaBonita(max: number) {
  if (max <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
const FONT_SVG = "font-family='Segoe UI, Arial, Helvetica, sans-serif'";

/** Barras agrupadas: ingresos vs. egresos de los últimos meses (el mes del reporte resaltado). */
export function svgIngresosEgresos(meses: { label: string; ingresos: number; egresos: number; actual?: boolean }[]) {
  const W = 520;
  const H = 300;
  const m = { l: 54, r: 10, t: 40, b: 34 };
  const ah = H - m.t - m.b;
  const aw = W - m.l - m.r;
  const max = escalaBonita(Math.max(...meses.flatMap((x) => [x.ingresos, x.egresos]), 0));
  const y = (v: number) => m.t + ah - (v / max) * ah;
  const g = aw / meses.length;
  const bw = Math.min(26, g * 0.32);
  const out: string[] = [`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' ${FONT_SVG}>`, `<rect width='${W}' height='${H}' fill='#fff'/>`];
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    out.push(`<line x1='${m.l}' x2='${W - m.r}' y1='${y(v)}' y2='${y(v)}' stroke='#${i ? 'E6ECEF' : 'B8C2C8'}' stroke-width='1'/>`);
    out.push(`<text x='${m.l - 6}' y='${y(v) + 4}' font-size='10' fill='#6B7280' text-anchor='end'>${compacto(v)}</text>`);
  }
  meses.forEach((x, i) => {
    const cx = m.l + g * i + g / 2;
    if (x.actual) out.push(`<rect x='${cx - g / 2 + 3}' y='${m.t - 4}' width='${g - 6}' height='${ah + 4}' fill='#E8F8F6' rx='6'/>`);
    for (const [k, v, color] of [
      [0, x.ingresos, '#38CBB9'],
      [1, x.egresos, '#989898'],
    ] as const) {
      const bx = cx - bw - 2 + k * (bw + 4);
      const by = y(v);
      out.push(`<rect x='${bx}' y='${by}' width='${bw}' height='${Math.max(0, m.t + ah - by)}' fill='${color}' rx='3'/>`);
      if (v > 0) out.push(`<text x='${bx + bw / 2}' y='${by - 4}' font-size='8.5' fill='#4B526F' text-anchor='middle'>${compacto(v)}</text>`);
    }
    out.push(`<text x='${cx}' y='${H - m.b + 16}' font-size='11' fill='#2E3446' text-anchor='middle'${x.actual ? " font-weight='700'" : ''}>${xml(x.label)}</text>`);
  });
  out.push(
    `<rect x='${m.l}' y='12' width='12' height='12' rx='2' fill='#38CBB9'/><text x='${m.l + 17}' y='22' font-size='11' fill='#2E3446'>Ingresos</text>`,
    `<rect x='${m.l + 90}' y='12' width='12' height='12' rx='2' fill='#989898'/><text x='${m.l + 107}' y='22' font-size='11' fill='#2E3446'>Egresos</text>`,
    '</svg>',
  );
  return { svg: out.join(''), W, H };
}

/** Barras horizontales: en qué se gastó el mes (las 6 categorías mayores; el resto, «Otras»). */
export function svgDistribucion(items: { label: string; monto: number }[]) {
  const W = 520;
  const H = 300;
  const out: string[] = [`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' ${FONT_SVG}>`, `<rect width='${W}' height='${H}' fill='#fff'/>`];
  const orden = items.filter((x) => x.monto > 0).sort((a, b) => b.monto - a.monto);
  const top = orden.slice(0, 6);
  const resto = orden.slice(6).reduce((s, x) => s + x.monto, 0);
  if (resto > 0) top.push({ label: 'Otras', monto: resto });
  if (!top.length) {
    out.push(`<text x='${W / 2}' y='${H / 2}' font-size='13' fill='#6B7280' text-anchor='middle'>Sin egresos registrados en el mes</text></svg>`);
    return { svg: out.join(''), W, H };
  }
  const total = top.reduce((s, x) => s + x.monto, 0);
  const max = Math.max(...top.map((x) => x.monto));
  const l = 168;
  const r = 118;
  const fila = Math.min(38, (H - 24) / top.length);
  const alto = Math.min(20, fila * 0.6);
  top.forEach((x, i) => {
    const cy = 16 + fila * i + fila / 2;
    const w = ((W - l - r) * x.monto) / max;
    const nombre = x.label.length > 26 ? `${x.label.slice(0, 25)}…` : x.label;
    out.push(`<text x='${l - 8}' y='${cy + 4}' font-size='11' fill='#2E3446' text-anchor='end'>${xml(nombre)}</text>`);
    out.push(`<rect x='${l}' y='${cy - alto / 2}' width='${Math.max(2, w)}' height='${alto}' rx='3' fill='${i ? '#7FD9CF' : '#007C7D'}'/>`);
    out.push(
      `<text x='${l + w + 6}' y='${cy + 4}' font-size='10.5' fill='#4B526F'>${compacto(x.monto)} · ${Math.round((x.monto / total) * 100)}%</text>`,
    );
  });
  out.push('</svg>');
  return { svg: out.join(''), W, H };
}

/** SVG → PNG (base64) en el navegador, al doble de resolución para que se vea nítido. */
export async function pngDeSvg(svg: string, W: number, H: number) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0, W, H);
  return canvas.toDataURL('image/png');
}

export async function logoBase64() {
  try {
    const r = await fetch('/marca/siia-horizontal.png');
    if (!r.ok) return undefined;
    const blob = await r.blob();
    return await new Promise<string>((ok, mal) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = mal;
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

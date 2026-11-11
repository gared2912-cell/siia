// Datos de autenticidad del recibo: número de serie y sello digital (SHA-512 de la cadena del pago: id interno, folio,
// condominio, unidad, monto y fechas), código QR con esa cadena e importe con letra. El mismo pago siempre da el mismo
// sello; cualquier cambio en el monto, la unidad o el folio da otro. Lo usan el recibo en pantalla y el PDF.
import type { ReciboData } from './Recibo';

export type SelloRecibo = { serie: string; sello: string; cadena: string; qr: string };

export async function selloRecibo(d: ReciboData): Promise<SelloRecibo> {
  const { pago, condominio, unidad } = d;
  const cadena = ['SIIA', pago.folio ?? '', condominio.nombre, unidad.etiqueta, pago.monto.toFixed(2), pago.fecha ?? '', (pago.validadoEn ?? '').slice(0, 10)].join('|');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(`${pago.id}|${cadena}`)));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const serie = `SIIA-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const sello = btoa(bin);
  const qr = `||${cadena}|${serie}|${sello.slice(-12)}||`;
  return { serie, sello, cadena, qr };
}

/** Imagen PNG (data URL) del código QR. */
export async function qrDataUrl(texto: string, px = 240): Promise<string> {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(texto, { errorCorrectionLevel: 'M', margin: 1, width: px, color: { dark: '#0b4f52', light: '#ffffff' } });
}

// ---------- Importe con letra (pesos mexicanos) ----------
const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function hastaMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let s = CENTENAS[c];
  if (r) {
    const d = r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` Y ${UNIDADES[r % 10]}` : ''}`;
    s = s ? `${s} ${d}` : d;
  }
  return s;
}

function enLetras(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${enLetras(millones)} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${hastaMil(miles)} MIL`);
  if (resto) partes.push(hastaMil(resto));
  return partes.join(' ');
}

/** 450 → «CUATROCIENTOS CINCUENTA PESOS 00/100 M.N.» */
export function importeConLetra(monto: number): string {
  const centavos = Math.round(monto * 100);
  const enteros = Math.floor(centavos / 100);
  const cts = String(centavos % 100).padStart(2, '0');
  const letras = enLetras(enteros);
  const deMillon = enteros >= 1_000_000 && enteros % 1_000_000 === 0;
  return `${letras}${deMillon ? ' DE' : ''} ${enteros === 1 ? 'PESO' : 'PESOS'} ${cts}/100 M.N.`;
}

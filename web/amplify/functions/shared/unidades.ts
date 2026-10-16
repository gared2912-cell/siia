// Etiquetas de unidades (casa o departamento). Sin dependencias: lo usan admin-api y el panel /admin.

export const TIPOS_UNIDAD: [string, string][] = [
  ['CASA', 'Casas'],
  ['DEPARTAMENTO', 'Departamentos'],
];

export const prefijoUnidad = (tipoUnidad?: string | null) => (tipoUnidad === 'DEPARTAMENTO' ? 'Depto' : 'Casa');

/** «A-101» → «Depto A-101»; «12» → «Casa 12». Si ya trae «Casa…» o «Depto…» se respeta. */
export function etiquetaUnidad(numero: unknown, tipoUnidad?: string | null) {
  const n = String(numero ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  if (!n) return '';
  const m = n.match(/^(casa|departamento|depto\.?|dpto\.?)\s*(.*)$/i);
  if (m) return `${/^casa/i.test(m[1]) ? 'Casa' : 'Depto'} ${m[2]}`.trim();
  return `${prefijoUnidad(tipoUnidad)} ${n}`;
}

/** Clave para comparar etiquetas sin importar mayúsculas, acentos, espacios o guiones. */
export const claveUnidad = (etiqueta: string) =>
  etiqueta
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Texto que ve el residente en Finanzas con los datos bancarios del condominio. */
export function textoDatosPago(c: {
  banco?: string | null;
  beneficiario?: string | null;
  clabe?: string | null;
  cuentaBancaria?: string | null;
  referenciaPago?: string | null;
  notasPago?: string | null;
}) {
  return [
    c.banco && `Banco: ${c.banco}`,
    c.beneficiario && `Beneficiario: ${c.beneficiario}`,
    c.clabe && `CLABE: ${c.clabe}`,
    c.cuentaBancaria && `Cuenta: ${c.cuentaBancaria}`,
    c.referenciaPago && `Referencia: ${c.referenciaPago}`,
    c.notasPago,
  ]
    .filter(Boolean)
    .join('\n');
}

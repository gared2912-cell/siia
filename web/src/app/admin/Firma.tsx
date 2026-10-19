// Firma de la administración: quién dio de alta o modificó un registro (la pone el servidor, ver shared/firma.ts).
// El correo solo llega al superadministrador; los demás administradores ven el nombre.

type DatosFirma = { nombre?: string; email?: string | null; rol?: string; en?: string };

export function leerFirma(v: unknown): DatosFirma | null {
  let f: unknown = v;
  try {
    for (let k = 0; k < 2 && typeof f === 'string'; k++) f = JSON.parse(f);
  } catch {
    return null;
  }
  return f && typeof f === 'object' && (f as DatosFirma).nombre ? (f as DatosFirma) : null;
}

const fechaHora = (d: string) =>
  new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const quien = (f: DatosFirma) => `${f.nombre}${f.rol === 'SUPERADMIN' ? ' (Superadmin)' : ''}${f.email ? ` · ${f.email}` : ''}`;

/** Cómo se llama el último cambio según el estado del registro (p. ej. un pago validado = «Aprobado por»). */
export function verboCambio(estado?: string | null): string | undefined {
  switch (estado) {
    case 'VALIDADO':
      return 'Aprobado por';
    case 'APROBADO':
    case 'APROBADA':
      return 'Aprobado por';
    case 'RECHAZADO':
    case 'RECHAZADA':
      return 'Rechazado por';
    case 'CANCELADO':
    case 'CANCELADA':
      return 'Cancelado por';
    case 'SUSPENDIDO':
      return 'Suspendido por';
    default:
      return undefined;
  }
}

/**
 * Líneas pequeñas «Registrado por … · fecha» y «Modificado por … · fecha».
 * `antes`: firma de registros anteriores a este cambio (p. ej. validadoPor), si no tienen la nueva.
 */
export function Firma({
  item,
  alta = 'Registrado por',
  cambio,
  antes,
  altaAntes,
}: {
  item: { firma?: unknown; firmaCambio?: unknown; estado?: string | null };
  alta?: string | false;
  cambio?: string;
  antes?: { verbo: string; por?: string | null; en?: string | null };
  /** Quién lo registró en registros anteriores a la firma (p. ej. registradoPorNombre). */
  altaAntes?: string | null;
}) {
  const a = leerFirma(item.firma);
  const c = leerFirma(item.firmaCambio);
  const lineas: string[] = [];
  if (a && alta) lineas.push(`${alta} ${quien(a)}${a.en ? ` · ${fechaHora(a.en)}` : ''}`);
  else if (altaAntes && alta) lineas.push(`${alta} ${altaAntes}`);
  if (c) lineas.push(`${cambio ?? verboCambio(item.estado) ?? 'Modificado por'} ${quien(c)}${c.en ? ` · ${fechaHora(c.en)}` : ''}`);
  else if (antes?.por) lineas.push(`${antes.verbo} ${antes.por}${antes.en ? ` · ${fechaHora(antes.en)}` : ''}`);
  if (!lineas.length) return null;
  return (
    <div className="firma">
      {lineas.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

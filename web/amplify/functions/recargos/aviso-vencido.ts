// Aviso de pago vencido: lo que recibe el residente al día siguiente del vencimiento (correo y/o notificación,
// según Condominio.avisoMorosidad). Incluye un estado de cuenta con todo lo que tiene pendiente, los datos para
// pagar y para qué se usa cada tipo de pago. Sin acceso a la base de datos para poder generar vistas previas.
import { botonCorreo, escaparHtml as e, etiquetaCorreo, notaCorreo, tituloCorreo } from '../shared/marco-correo';
import { tipoDeCargo } from '../shared/finanzas';

export type CargoPendiente = { id: string; concepto: string; monto: number; vence?: string | null; tipo?: string | null };

export type DatosAviso = {
  condominio: { nombre: string; banco?: string; beneficiario?: string; clabe?: string; cuentaBancaria?: string; referenciaPago?: string; notasPago?: string };
  unidad: string; // «Depto 204»
  nombre?: string; // del residente (solo para el correo)
  cargos: CargoPendiente[]; // todos los pendientes de la unidad
  nuevos: string[]; // ids de los cargos que vencieron y motivan este aviso
  hoy: string;
  portal: string;
};

export const mxn = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
export const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, d)));
};

// Para qué se usa cada tipo de pago (se muestran solo los tipos que la unidad tiene pendientes).
const DESTINO: Record<string, string> = {
  CUOTA: 'Las cuotas de mantenimiento cubren la operación diaria del condominio: seguridad, limpieza, jardinería, servicios y el cuidado de las áreas comunes.',
  MANT_INTERNO: 'Los cargos de mantenimiento se destinan a los trabajos programados para conservar el condominio en buen estado.',
  MANT_EXTERNO: 'Los cargos de mantenimiento se destinan a los trabajos programados para conservar el condominio en buen estado.',
  RECAUDACION: 'Las cuotas extraordinarias se destinan al proyecto u obra aprobada para el condominio.',
  RESERVA: 'Los cargos de amenidades corresponden a las reservas que solicitaste.',
  RECARGO: 'El recargo por pago tardío se aplica cuando una cuota no se paga a tiempo.',
};

export function armarAviso(d: DatosAviso) {
  const cargos = [...d.cargos].sort((a, b) => String(a.vence ?? '9999').localeCompare(String(b.vence ?? '9999')));
  // El recargo se carga con vencimiento del día en que se aplica, pero ya es un adeudo vencido.
  const vencido = (x: CargoPendiente) => tipoDeCargo(x) === 'RECARGO' || (!!x.vence && x.vence < d.hoy);
  const vencidos = cargos.filter(vencido);
  const nuevos = cargos.filter((x) => d.nuevos.includes(x.id));
  const anteriores = vencidos.filter((x) => !d.nuevos.includes(x.id));
  const total = cargos.reduce((s, x) => s + (Number(x.monto) || 0), 0);
  const totalVencido = vencidos.reduce((s, x) => s + (Number(x.monto) || 0), 0);
  const principal = nuevos[0] ?? vencidos[0];
  const destinos = [...new Set(cargos.map((x) => DESTINO[tipoDeCargo(x)]).filter(Boolean))];
  const c = d.condominio;

  const queVencio = nuevos.length > 1 ? `${nuevos.length} pagos vencieron` : `Tu ${principal.concepto.toLowerCase().replace(/ · /g, ' de ')} venció el ${fechaLarga(principal.vence!)}`;
  const resumen = `${queVencio} y no tenemos registrado tu pago ni un comprobante por revisar.${
    anteriores.length ? ` Además tienes ${anteriores.length === 1 ? 'un pago anterior vencido' : `${anteriores.length} pagos anteriores vencidos`}.` : ''
  }`;

  // ---------- notificación (campana del portal y app) ----------
  const avisoTitulo = `Pago vencido: ${mxn(totalVencido)}`;
  const avisoTexto = `${resumen} Total pendiente: ${mxn(total)}. Consulta el desglose y los datos para pagar en Finanzas.`;

  // ---------- correo ----------
  const fila = (x: CargoPendiente) => {
    const v = vencido(x);
    const estado = !x.vence
      ? 'Sin fecha de vencimiento'
      : tipoDeCargo(x) === 'RECARGO'
        ? `Aplicado el ${fechaLarga(x.vence)}`
        : v
          ? `Venció el ${fechaLarga(x.vence)}`
          : `Vence el ${fechaLarga(x.vence)}`;
    const chip = v
      ? '<span style="display:inline-block;background:#fdecea;color:#a3261b;font-size:11px;font-weight:bold;letter-spacing:.5px;padding:2px 8px;border-radius:999px;margin:0 0 4px">VENCIDO</span><br>'
      : '<span style="display:inline-block;background:#eef1f4;color:#4b526f;font-size:11px;font-weight:bold;letter-spacing:.5px;padding:2px 8px;border-radius:999px;margin:0 0 4px">POR VENCER</span><br>';
    return `<tr>
          <td style="padding:12px 0;border-bottom:1px solid #e6ecef;vertical-align:top">${chip}<span style="font-weight:bold;color:#2f3450">${e(x.concepto)}</span><br><span style="font-size:12px;color:#676d86">${estado}</span></td>
          <td style="padding:12px 0 12px 10px;border-bottom:1px solid #e6ecef;vertical-align:top;text-align:right;white-space:nowrap;font-weight:bold;color:${v ? '#a3261b' : '#2f3450'}">${mxn(Number(x.monto) || 0)}</td>
        </tr>`;
  };
  const datoPago = (etq: string, val?: string, mono = false) =>
    val ? `<tr><td style="padding:3px 0;color:#676d86;font-size:13px;white-space:nowrap;vertical-align:top">${etq}</td><td style="padding:3px 0 3px 12px;font-size:14px;${mono ? 'font-family:Consolas,monospace;word-break:break-all' : 'overflow-wrap:anywhere'}">${e(val)}</td></tr>` : '';
  const datos = [
    datoPago('Banco', c.banco),
    datoPago('Beneficiario', c.beneficiario),
    datoPago('CLABE', c.clabe, true),
    datoPago('Cuenta', c.cuentaBancaria, true),
    datoPago('Referencia', c.referenciaPago || d.unidad),
  ].join('');

  const contenido = `
      ${etiquetaCorreo(`${e(c.nombre)} · ${e(d.unidad)}`)}
      ${tituloCorreo('Tienes un pago vencido')}
      <p style="margin:0 0 16px;line-height:1.5">Hola${d.nombre ? ` ${e(d.nombre)}` : ''}: ${e(resumen)}</p>
      <table role="presentation" width="100%" style="background:#e9faf8;border-radius:10px;border:1px solid #baf1ed;margin:0 0 22px"><tr>
        <td style="padding:16px 18px;vertical-align:top">
          <div style="font-size:12px;color:#4b526f;text-transform:uppercase;letter-spacing:1px">Vencido</div>
          <div style="font-size:26px;font-weight:bold;color:#a3261b;white-space:nowrap">${mxn(totalVencido)}</div>
        </td>
        <td style="padding:16px 18px;vertical-align:top;text-align:right">
          <div style="font-size:12px;color:#4b526f;text-transform:uppercase;letter-spacing:1px">Total a pagar</div>
          <div style="font-size:26px;font-weight:bold;color:#007c7d;white-space:nowrap">${mxn(total)}</div>
        </td>
      </tr></table>
      <div style="font-size:15px;font-weight:bold;color:#2f3450;margin:0 0 4px">Tu estado de cuenta pendiente</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 6px">${cargos.map(fila).join('')}
        <tr>
          <td style="padding:12px 0;font-weight:bold;color:#2f3450">Total pendiente</td>
          <td style="padding:12px 0 12px 10px;text-align:right;white-space:nowrap;font-weight:bold;font-size:17px;color:#007c7d">${mxn(total)}</td>
        </tr>
      </table>
      <p style="margin:0 0 18px;line-height:1.5">Te pedimos realizar tu pago <strong>lo antes posible</strong>. ${destinos.map(e).join(' ')} Tu pago puntual permite que el condominio siga funcionando como todos esperamos.</p>
      ${
        datos
          ? `<table role="presentation" width="100%" style="background:#f5f9fa;border-radius:10px;border:1px solid #dfe6ea;margin:0 0 18px"><tr><td style="padding:16px 18px">
        <div style="font-size:15px;font-weight:bold;color:#2f3450;margin:0 0 8px">Datos para tu pago</div>
        <table role="presentation" style="border-collapse:collapse">${datos}</table>
        ${c.notasPago ? `<div style="font-size:13px;color:#4b526f;margin:10px 0 0;line-height:1.5">${e(c.notasPago)}</div>` : ''}
      </td></tr></table>`
          : ''
      }
      ${botonCorreo('Pagar y subir mi comprobante', d.portal)}
      ${notaCorreo('Después de pagar, sube tu comprobante en el portal, sección Finanzas, para que la administración lo valide y te emita tu recibo.')}
      ${notaCorreo('Si ya pagaste, sube tu comprobante y no tomes en cuenta este aviso.', true)}`;

  const texto = [
    `Hola${d.nombre ? ` ${d.nombre}` : ''}:`,
    resumen,
    `Tu estado de cuenta pendiente (${c.nombre} · ${d.unidad}):`,
    ...cargos.map((x) => `- ${x.concepto}: ${mxn(Number(x.monto) || 0)} (${!x.vence ? 'sin fecha' : vencido(x) ? `venció el ${fechaLarga(x.vence)}` : `vence el ${fechaLarga(x.vence)}`})`),
    `Vencido: ${mxn(totalVencido)} · Total pendiente: ${mxn(total)}`,
    `Te pedimos realizar tu pago lo antes posible. ${destinos.join(' ')}`,
    [c.banco && `Banco: ${c.banco}`, c.beneficiario && `Beneficiario: ${c.beneficiario}`, c.clabe && `CLABE: ${c.clabe}`, c.cuentaBancaria && `Cuenta: ${c.cuentaBancaria}`, `Referencia: ${c.referenciaPago || d.unidad}`, c.notasPago]
      .filter(Boolean)
      .join('\n'),
    `Pagar y subir mi comprobante:\n${d.portal}`,
    'Si ya pagaste, sube tu comprobante en el portal, sección Finanzas, y no tomes en cuenta este aviso.',
  ].join('\n\n');

  return { asunto: `Pago vencido · ${d.unidad} · ${c.nombre}`, contenido, texto, avisoTitulo, avisoTexto };
}

// Recibo de pago imprimible (se genera a partir de un pago validado con folio): banda corporativa, datos del pago,
// conceptos, importe con letra, número de serie, sello digital, código QR y sello «PAGADO» (ver reciboSello.ts).
import { useEffect, useState } from 'react';
import { Icon, fecha, money, useAction } from './ui';
import { importeConLetra, qrDataUrl, selloRecibo, type SelloRecibo } from './reciboSello';

type PagoRecibo = {
  id: string;
  folio?: string;
  monto: number;
  fecha?: string;
  referencia?: string;
  validadoEn?: string;
  saldoFavorUsado?: number | null;
  ajuste?: string | null;
  diferencia?: number | null;
  abonoOtros?: number | null;
};
type CargoRecibo = { id: string; concepto: string; monto: number; montoOriginal?: number | null };

export type ReciboData = {
  pago: PagoRecibo;
  cargos: CargoRecibo[];
  condominio: { nombre: string; direccion?: string };
  unidad: { etiqueta: string; propietario?: string };
};

type PagoBD = { id: string; folio?: string | null; monto: number; fecha?: string | null; referencia?: string | null; validadoEn?: string | null } & Partial<
  Record<'saldoFavorUsado' | 'diferencia' | 'abonoOtros', number | null> & Record<'ajuste', string | null>
>;

/** Datos del pago para el recibo (los registros traen null donde el recibo espera undefined). */
export const pagoRecibo = (p: PagoBD): PagoRecibo => ({
  id: p.id,
  folio: p.folio ?? '',
  monto: p.monto,
  fecha: p.fecha ?? undefined,
  referencia: p.referencia ?? undefined,
  validadoEn: p.validadoEn ?? undefined,
  saldoFavorUsado: p.saldoFavorUsado,
  ajuste: p.ajuste,
  diferencia: p.diferencia,
  abonoOtros: p.abonoOtros,
});
export const cargoRecibo = (c: CargoRecibo): CargoRecibo => ({ id: c.id, concepto: c.concepto, monto: c.monto, montoOriginal: c.montoOriginal });

/** Concepto en el recibo: un abono parcial dice de cuánto era el cargo. */
export const conceptoRecibo = (c: CargoRecibo, fmt: (n: number) => string) =>
  c.montoOriginal && c.montoOriginal !== c.monto ? `${c.concepto} (abono; el cargo era de ${fmt(c.montoOriginal)})` : c.concepto;

/** Líneas bajo el total: saldo a favor usado y qué pasó con la diferencia. */
export function notasRecibo(p: PagoRecibo, fmt: (n: number) => string): string[] {
  const n: string[] = [];
  if (p.saldoFavorUsado) n.push(`Saldo a favor aplicado: ${fmt(p.saldoFavorUsado)}`);
  if (p.abonoOtros) n.push(`Excedente abonado a otros cargos pendientes: ${fmt(p.abonoOtros)}`);
  const d = p.diferencia ?? 0;
  if (p.ajuste === 'PARCIAL') n.push(`Pago parcial: queda pendiente ${fmt(d)}`);
  if (p.ajuste === 'CONDONADO') n.push(`Diferencia condonada por la administración: ${fmt(d)}`);
  if (p.ajuste === 'SALDO_FAVOR') n.push(`Excedente abonado al saldo a favor: ${fmt(d)}`);
  if (p.ajuste === 'EXCEDENTE') n.push(`Excedente registrado como otro ingreso: ${fmt(d)}`);
  return n;
}

export function Recibo({ data }: { data: ReciboData }) {
  const { pago, cargos, condominio, unidad } = data;
  const [sello, setSello] = useState<SelloRecibo | null>(null);
  const [qr, setQr] = useState('');
  useEffect(() => {
    let vivo = true;
    selloRecibo(data)
      .then(async (s) => {
        if (!vivo) return;
        setSello(s);
        const img = await qrDataUrl(s.qr);
        if (vivo) setQr(img);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pago.id, pago.folio, pago.monto]);
  const imprimir = () => {
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 500);
  };
  const { run, busy } = useAction();
  const descargar = () =>
    run(async () => {
      const { descargarRecibo } = await import('./reciboPdf');
      await descargarRecibo(data);
    }, 'Recibo descargado');
  const filas = cargos.length ? cargos.map((c) => ({ id: c.id, concepto: conceptoRecibo(c, money), monto: c.monto })) : [{ id: 'cuenta', concepto: 'Pago a cuenta de mantenimiento', monto: pago.monto }];
  const notas = notasRecibo(pago, money);
  return (
    <>
      <div className="recibo">
        <div className="recibo-marco">
          <img className="recibo-agua" src="/marca/isotipo.svg" alt="" aria-hidden="true" />
          <header className="recibo-banda">
            <img src="/marca/siia-horizontal-blanco.svg" alt="SIIA · soluciones inmobiliarias" />
            <div className="recibo-folio">
              <span>Recibo de pago</span>
              <strong>{pago.folio}</strong>
              <small>Validado el {fecha(pago.validadoEn)}</small>
            </div>
          </header>
          <div className="recibo-cuerpo">
            <dl className="recibo-datos">
              <div className="ancho">
                <dt>Condominio</dt>
                <dd>
                  {condominio.nombre}
                  {condominio.direccion && <small>{condominio.direccion}</small>}
                </dd>
              </div>
              <div>
                <dt>Casa o departamento</dt>
                <dd>{unidad.etiqueta}</dd>
              </div>
              {unidad.propietario && (
                <div>
                  <dt>Residente</dt>
                  <dd>{unidad.propietario}</dd>
                </div>
              )}
              <div>
                <dt>Fecha de pago</dt>
                <dd>{fecha(pago.fecha)}</dd>
              </div>
              <div>
                <dt>Referencia</dt>
                <dd>{pago.referencia || '—'}</dd>
              </div>
            </dl>

            <table className="recibo-tabla">
              <thead>
                <tr>
                  <th className="n">#</th>
                  <th>Concepto</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c, i) => (
                  <tr key={c.id}>
                    <td className="n">{i + 1}</td>
                    <td>{c.concepto}</td>
                    <td className="num">{money(c.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="recibo-total-caja">
              <div className="recibo-total-fila">
                <span>Total recibido</span>
                <strong>{money(pago.monto)}</strong>
              </div>
              <div className="recibo-letra">({importeConLetra(pago.monto)})</div>
              {notas.map((t) => (
                <div key={t} className="recibo-nota">
                  {t}
                </div>
              ))}
            </div>

            <div className="recibo-sello">
              <div className="recibo-qr">{qr ? <img src={qr} alt="Código QR del recibo" /> : <span />}</div>
              <div className="recibo-sello-texto">
                <div>
                  <span>No. de serie</span>
                  <strong>{sello?.serie ?? '…'}</strong>
                </div>
                <div>
                  <span>Sello digital SIIA</span>
                  <code>{sello?.sello ?? '…'}</code>
                </div>
              </div>
              <SelloPagado folio={pago.folio ?? ''} fecha={fecha(pago.validadoEn)} />
            </div>
          </div>
          <footer className="recibo-pie">
            SIIA · Sistemas Integrales Inmobiliarios y de Administración · siia.casa
            <br />
            Documento sin validez fiscal. El número de serie y el sello digital identifican este recibo de forma única.
          </footer>
        </div>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn-app" disabled={busy} onClick={descargar}>
          <Icon name="download" />
          {busy ? 'Generando…' : 'Descargar PDF'}
        </button>
        <button className="btn-app secondary" onClick={imprimir}>
          <Icon name="print" />
          Imprimir
        </button>
      </div>
    </>
  );
}

/** Sello circular «PAGADO» con el folio y la fecha de validación. */
function SelloPagado({ folio, fecha: f }: { folio: string; fecha: string }) {
  const id = `arco-${folio.replace(/[^A-Za-z0-9]/g, '')}`;
  return (
    <svg className="recibo-estampa" viewBox="0 0 120 120" role="img" aria-label={`Pagado · ${folio} · ${f}`}>
      <defs>
        <path id={`${id}-a`} d="M 60 60 m -44 0 a 44 44 0 1 1 88 0" />
        <path id={`${id}-b`} d="M 60 60 m -48 0 a 48 48 0 0 0 96 0" />
      </defs>
      <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="60" cy="60" r="36" fill="none" stroke="currentColor" strokeWidth="1" />
      <text fontSize="9.5" fontWeight="700" letterSpacing="1.6" fill="currentColor">
        <textPath href={`#${id}-a`} startOffset="50%" textAnchor="middle">
          SIIA · ADMINISTRACIÓN
        </textPath>
      </text>
      <text fontSize="8" fontWeight="700" letterSpacing="1.2" fill="currentColor">
        <textPath href={`#${id}-b`} startOffset="50%" textAnchor="middle">
          {folio}
        </textPath>
      </text>
      <text x="60" y="58" textAnchor="middle" fontSize="15" fontWeight="800" letterSpacing="1" fill="currentColor">
        PAGADO
      </text>
      <text x="60" y="72" textAnchor="middle" fontSize="7.5" fontWeight="600" fill="currentColor">
        {f}
      </text>
    </svg>
  );
}

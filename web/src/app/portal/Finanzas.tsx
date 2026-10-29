import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { ElegirArchivo } from '../ElegirArchivo';
import { Recibo, type ReciboData } from '../Recibo';
import { Acciones, Archivo, Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tarjeta, TarjetaIcono, Tarjetas, fecha, hoy, money, tonoDe, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';
import { useAvisos } from './Notificaciones';
import { AJUSTES_PAGO, favorAUsar, r2, type AjustePago } from '../../../amplify/functions/shared/pagos';

type Cargo = { id: string; concepto: string; periodo?: string; monto: number; vence?: string; estado: string };
type Pago = { id: string; monto: number; fecha?: string; referencia?: string; estado: string; folio?: string; nota?: string; comprobantePath?: string; createdAt: string; cargoIds?: string[]; validadoEn?: string;
  ajuste?: string; diferencia?: number; saldoFavorUsado?: number; montoDeclarado?: number };
type Estado = {
  saldo: number;
  cargos: Cargo[];
  pagos: Pago[];
  datosPago: string | null;
  saldoFavor: number;
  cuota: number | null;
  titular?: { condominio: string; direccion: string | null; unidad: string; residente: string };
};

export function Finanzas(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Estado>('finanzas.estadoCuenta'));
  const [pagar, setPagar] = useState(false);
  const [recibo, setRecibo] = useState<ReciboData | null>(null);
  const [fichaPago, setFichaPago] = useState<Pago | null>(null);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const r = data!;
  const hoyStr = hoy();
  const pendientes = r.cargos.filter((c) => c.estado === 'PENDIENTE');
  const enRevision = r.pagos.filter((p) => p.estado === 'EN_REVISION').reduce((s, p) => s + p.monto, 0);

  const resultado = (p: Pago) =>
    p.ajuste && p.ajuste !== 'COMPLETO' ? `${AJUSTES_PAGO[p.ajuste as AjustePago] ?? ''}${p.diferencia ? `: ${money(p.diferencia)}` : ''}` : null;
  const verRecibo = (id: string) => run(async () => setRecibo(await portal<ReciboData>('finanzas.recibo', { pagoId: id })));
  // Historial de pagos en PDF (protegido: solo ver e imprimir)
  const historial = () =>
    run(async () => {
      const { descargarHistorial } = await import('../historialPdf');
      await descargarHistorial({
        condominio: r.titular?.condominio ?? '',
        direccion: r.titular?.direccion,
        unidad: r.titular?.unidad ?? '',
        residente: r.titular?.residente,
        cargos: r.cargos,
        pagos: r.pagos,
        hoy: hoyStr,
      });
    }, 'Historial de pagos descargado');

  return (
    <div className="stack">
      <PageHead icon="money" title="Finanzas" sub="Estado de cuenta de tu unidad, pagos y recibos.">
        <button className="btn-app secondary" onClick={historial}>
          <Icon name="download" />
          Historial de pagos (PDF)
        </button>
        <button className="btn-app" onClick={() => setPagar(true)}>
          <Icon name="plus" />
          Subir comprobante
        </button>
      </PageHead>

      <div className="grid-cards">
        <div className="stat">
          <div className="stat-label">Saldo pendiente</div>
          <div className={`stat-value ${r.saldo > 0 ? 'is-alert' : 'is-ok'}`}>{money(r.saldo)}</div>
          <div className="small muted">{pendientes.length} cargo(s) por pagar</div>
        </div>
        <div className="stat">
          <div className="stat-label">Pagos en revisión</div>
          <div className="stat-value">{money(enRevision)}</div>
          <div className="small muted">La administración valida tus comprobantes</div>
        </div>
        {r.saldoFavor > 0 && (
          <div className="stat">
            <div className="stat-label">Saldo a favor</div>
            <div className="stat-value is-ok">{money(r.saldoFavor)}</div>
            <div className="small muted">Se descuenta de tus próximos pagos</div>
          </div>
        )}
        {r.cuota != null && (
          <div className="stat">
            <div className="stat-label">Cuota de mantenimiento</div>
            <div className="stat-value">{money(r.cuota)}</div>
            <div className="small muted">Mensual</div>
          </div>
        )}
      </div>

      {r.datosPago && (
        <section className="panel">
          <h2>Datos para tu pago</h2>
          <p className="pre" style={{ margin: 0 }}>
            {r.datosPago}
          </p>
        </section>
      )}

      <section className="panel">
        <h2>Cargos</h2>
        {r.cargos.length ? (
          <Tarjetas>
            {r.cargos.map((c) => {
              const vencido = c.estado === 'PENDIENTE' && !!c.vence && c.vence < hoyStr;
              return (
                <Tarjeta
                  key={c.id}
                  tono={vencido ? 'mal' : tonoDe(c.estado)}
                  onClick={c.estado === 'PENDIENTE' ? () => setPagar(true) : undefined}
                  label={c.estado === 'PENDIENTE' ? `Subir comprobante de ${c.concepto}` : undefined}
                  titulo={c.concepto}
                  sub={c.vence ? `Vence ${fecha(c.vence)}` : undefined}
                  lado={
                    <>
                      <strong>{money(c.monto)}</strong>
                      <Badge estado={vencido ? 'VENCIDO' : c.estado}>{vencido ? 'Vencido' : undefined}</Badge>
                    </>
                  }
                />
              );
            })}
          </Tarjetas>
        ) : (
          <Empty icon="money">Aún no hay cargos registrados.</Empty>
        )}
      </section>

      <section className="panel">
        <h2>Mis pagos y recibos</h2>
        {r.pagos.length ? (
          <Tarjetas>
            {r.pagos.map((p) => (
              <Tarjeta
                key={p.id}
                tono={tonoDe(p.estado)}
                onClick={() => (p.estado === 'VALIDADO' ? verRecibo(p.id) : setFichaPago(p))}
                media={<TarjetaIcono name="file" />}
                titulo={p.folio ? `Recibo ${p.folio}` : 'Comprobante enviado'}
                sub={`Pagado el ${fecha(p.fecha)}${p.referencia ? ` · Ref. ${p.referencia}` : ''}${resultado(p) ? ` · ${resultado(p)}` : ''}`}
                lado={
                  <>
                    <strong>{money(p.monto)}</strong>
                    <Badge estado={p.estado} />
                  </>
                }
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="file">Cuando registres un pago aparecerá aquí.</Empty>
        )}
      </section>

      {pagar && (
        <RegistrarPago
          pendientes={pendientes}
          saldoFavor={r.saldoFavor}
          onClose={() => setPagar(false)}
          onDone={() => {
            setPagar(false);
            reload(true);
          }}
        />
      )}
      {fichaPago && (
        <Modal title="Comprobante de pago" onClose={() => setFichaPago(null)}>
          <div className="stack">
            <div className="row-actions">
              <Badge estado={fichaPago.estado} />
              <strong>{money(fichaPago.monto)}</strong>
            </div>
            <Datos
              items={[
                ['Fecha de pago', fecha(fichaPago.fecha)],
                ['Referencia', fichaPago.referencia],
                ['Enviado', fecha(fichaPago.createdAt)],
                ['Resultado', resultado(fichaPago)],
                [fichaPago.estado === 'RECHAZADO' ? 'Motivo del rechazo' : 'Nota', fichaPago.nota],
              ]}
            />
            {fichaPago.estado === 'EN_REVISION' && <p className="small muted" style={{ margin: 0 }}>La administración está revisando tu comprobante. Te avisaremos cuando lo apruebe.</p>}
            <Acciones>
              <Archivo path={fichaPago.comprobantePath} label="Ver comprobante" />
              {fichaPago.estado === 'RECHAZADO' && (
                <button className="btn-app" onClick={() => (setFichaPago(null), setPagar(true))}>
                  <Icon name="plus" />
                  Subir otro comprobante
                </button>
              )}
            </Acciones>
          </div>
        </Modal>
      )}
      {recibo && (
        <Modal title={`Recibo ${recibo.pago.folio}`} onClose={() => setRecibo(null)} wide>
          <Recibo data={recibo} />
        </Modal>
      )}
    </div>
  );
}

function RegistrarPago({ pendientes, saldoFavor, onClose, onDone }: { pendientes: Cargo[]; saldoFavor: number; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>(pendientes.map((c) => c.id));
  const [usarFavor, setUsarFavor] = useState(saldoFavor > 0);
  const totalDe = (ids: string[]) => r2(pendientes.filter((c) => ids.includes(c.id)).reduce((s, c) => s + c.monto, 0));
  // Monto sugerido: el total de los cargos menos el saldo a favor que se descuenta.
  const sugerido = (ids: string[], favor: boolean) => {
    const t = totalDe(ids);
    return String(r2(t - (favor ? Math.min(saldoFavor, t) : 0)) || '');
  };
  const total = totalDe(sel);
  const [monto, setMonto] = useState(sugerido(sel, usarFavor));
  const [fechaPago, setFecha] = useState(hoy());
  const [referencia, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const { run, busy } = useAction();
  const { refrescar } = useAvisos();

  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    setMonto(sugerido(next, usarFavor));
  };
  const pagado = r2(Number(monto) || 0);
  const favor = usarFavor ? favorAUsar(saldoFavor, total, pagado) : 0;
  const dif = r2(pagado + favor - total);
  // Pagó de más y tiene otros cargos sin marcar: se le pregunta si quiere abonar lo que sobra a esos cargos.
  const sinMarcar = pendientes.filter((c) => !sel.includes(c.id));
  const abonarOtros = () => setSel([...sel, ...sinMarcar.map((c) => c.id)]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      if (!file) throw new Error('Adjunta tu comprobante de pago.');
      const comprobantePath = await subirArchivo(file, 'comprobantes');
      await portal('finanzas.registrarPago', { monto: Number(monto), fecha: fechaPago, referencia, comprobantePath, cargoIds: sel, usarSaldoFavor: usarFavor && favor > 0 });
    });
    if (okk) {
      refrescar(); // trae el aviso «Comprobante de pago recibido» y lo muestra al momento
      onDone();
    }
  }

  return (
    <Modal title="Subir comprobante" onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        {pendientes.length > 0 && (
          <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Cargos que cubre este pago</span>
            {pendientes.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />
                {c.concepto} · {money(c.monto)}
              </label>
            ))}
          </fieldset>
        )}
        {saldoFavor > 0 && total > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={usarFavor}
              onChange={(e) => (setUsarFavor(e.target.checked), setMonto(sugerido(sel, e.target.checked)))}
            />
            Usar mi saldo a favor ({money(saldoFavor)})
          </label>
        )}
        <div className="form-2">
          <Field label="Monto pagado (el que dice tu comprobante)">
            <input required type="number" min="1" step="0.01" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Field>
          <Field label="Fecha del pago">
            <input required type="date" max={hoy()} value={fechaPago} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>
        {total > 0 && pagado > 0 && (
          <div className={`cuadre ${Math.abs(dif) < 0.005 ? 'ok' : dif < 0 ? 'warn' : 'info'}`}>
            <div>
              <span>Cargos seleccionados</span>
              <span>{money(total)}</span>
            </div>
            <div>
              <span>Tu pago</span>
              <span>{money(pagado)}</span>
            </div>
            {favor > 0 && (
              <div>
                <span>Saldo a favor que se descuenta</span>
                <span>{money(favor)}</span>
              </div>
            )}
            <div className="cuadre-res">
              <span>{Math.abs(dif) < 0.005 ? 'Cubres el total' : dif < 0 ? 'Pago parcial: quedaría pendiente' : 'Te quedaría a favor'}</span>
              <span>{Math.abs(dif) < 0.005 ? <Icon name="check" /> : money(Math.abs(dif))}</span>
            </div>
          </div>
        )}
        {dif >= 0.005 && pagado > 0 && sinMarcar.length > 0 && (
          <div className="alert small" style={{ margin: 0 }}>
            <p style={{ margin: '0 0 8px' }}>
              {total > 0 ? `Te sobran ${money(dif)}.` : `Tu pago es de ${money(pagado)}.`} También tienes pendiente:{' '}
              {sinMarcar.map((c) => `${c.concepto} (${money(c.monto)})`).join(', ')}. ¿Quieres abonar tu pago a esos cargos?
            </p>
            <button type="button" className="btn-app sm" onClick={abonarOtros}>
              Sí, abonar a mis otros cargos
            </button>
          </div>
        )}
        {Math.abs(dif) >= 0.005 && total > 0 && pagado > 0 && !(dif > 0 && sinMarcar.length > 0) && (
          <p className="small muted" style={{ margin: 0 }}>
            La administración revisa tu comprobante y confirma el monto. Te avisaremos{' '}
            {dif < 0 ? 'cuánto queda pendiente.' : 'cuánto tienes a favor; se descuenta de tus próximos pagos.'}
          </p>
        )}
        <Field label="Referencia o clave de rastreo (opcional)">
          <input maxLength={120} value={referencia} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field grupo label="Comprobante" hint="Foto o PDF, máximo 8 MB.">
          <ElegirArchivo pdf value={file} onChange={(fs) => setFile(fs[0] ?? null)} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Subiendo comprobante…' : 'Enviar comprobante'}
        </button>
      </form>
    </Modal>
  );
}

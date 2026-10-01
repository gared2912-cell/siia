import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { Recibo, type ReciboData } from '../Recibo';
import { Archivo, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, fecha, hoy, money, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';
import { useAvisos } from './Notificaciones';

type Cargo = { id: string; concepto: string; periodo?: string; monto: number; vence?: string; estado: string };
type Pago = { id: string; monto: number; fecha?: string; referencia?: string; estado: string; folio?: string; nota?: string; comprobantePath?: string; createdAt: string };
type Estado = { saldo: number; cargos: Cargo[]; pagos: Pago[]; datosPago: string | null; cuota: number | null };

export function Finanzas(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Estado>('finanzas.estadoCuenta'));
  const [pagar, setPagar] = useState(false);
  const [recibo, setRecibo] = useState<ReciboData | null>(null);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const r = data!;
  const hoyStr = hoy();
  const pendientes = r.cargos.filter((c) => c.estado === 'PENDIENTE');
  const enRevision = r.pagos.filter((p) => p.estado === 'EN_REVISION').reduce((s, p) => s + p.monto, 0);

  const verRecibo = (id: string) => run(async () => setRecibo(await portal<ReciboData>('finanzas.recibo', { pagoId: id })));

  return (
    <div className="stack">
      <PageHead icon="money" title="Finanzas" sub="Estado de cuenta de tu unidad, pagos y recibos.">
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
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Vence</th>
                  <th className="num">Monto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {r.cargos.map((c) => (
                  <tr key={c.id}>
                    <td>{c.concepto}</td>
                    <td>{fecha(c.vence)}</td>
                    <td className="num">{money(c.monto)}</td>
                    <td>
                      <Badge estado={c.estado === 'PENDIENTE' && c.vence && c.vence < hoyStr ? 'VENCIDO' : c.estado}>
                        {c.estado === 'PENDIENTE' && c.vence && c.vence < hoyStr ? 'Vencido' : undefined}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="money">Aún no hay cargos registrados.</Empty>
        )}
      </section>

      <section className="panel">
        <h2>Mis pagos y recibos</h2>
        {r.pagos.length ? (
          <ul className="list">
            {r.pagos.map((p) => (
              <li key={p.id}>
                <div className="list-main">
                  <strong>{money(p.monto)}</strong> <Badge estado={p.estado} />
                  <div className="list-sub">
                    {fecha(p.fecha)} {p.referencia && `· Ref. ${p.referencia}`} {p.folio && `· Folio ${p.folio}`}
                  </div>
                  {p.nota && <div className="small">{p.nota}</div>}
                  <Archivo path={p.comprobantePath} label="Ver comprobante" />
                </div>
                {p.estado === 'VALIDADO' && (
                  <button className="btn-app sm secondary" onClick={() => verRecibo(p.id)}>
                    <Icon name="file" />
                    Recibo
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="file">Cuando registres un pago aparecerá aquí.</Empty>
        )}
      </section>

      {pagar && (
        <RegistrarPago
          pendientes={pendientes}
          onClose={() => setPagar(false)}
          onDone={() => {
            setPagar(false);
            reload(true);
          }}
        />
      )}
      {recibo && (
        <Modal title={`Recibo ${recibo.pago.folio}`} onClose={() => setRecibo(null)} wide>
          <Recibo data={recibo} />
        </Modal>
      )}
    </div>
  );
}

function RegistrarPago({ pendientes, onClose, onDone }: { pendientes: Cargo[]; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>(pendientes.map((c) => c.id));
  const total = pendientes.filter((c) => sel.includes(c.id)).reduce((s, c) => s + c.monto, 0);
  const [monto, setMonto] = useState(total ? String(total) : '');
  const [fechaPago, setFecha] = useState(hoy());
  const [referencia, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const { run, busy } = useAction();
  const { refrescar } = useAvisos();

  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    setMonto(String(pendientes.filter((c) => next.includes(c.id)).reduce((s, c) => s + c.monto, 0) || ''));
  };

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      if (!file) throw new Error('Adjunta tu comprobante de pago.');
      const comprobantePath = await subirArchivo(file, 'comprobantes');
      await portal('finanzas.registrarPago', { monto: Number(monto), fecha: fechaPago, referencia, comprobantePath, cargoIds: sel });
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
        <div className="form-2">
          <Field label="Monto pagado">
            <input required type="number" min="1" step="0.01" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Field>
          <Field label="Fecha del pago">
            <input required type="date" max={hoy()} value={fechaPago} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>
        <Field label="Referencia o clave de rastreo (opcional)">
          <input maxLength={120} value={referencia} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label="Comprobante" hint="Imagen o PDF, máximo 8 MB.">
          <input required type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Subiendo comprobante…' : 'Enviar comprobante'}
        </button>
      </form>
    </Modal>
  );
}

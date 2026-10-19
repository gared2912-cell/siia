// Finanzas › Egresos (gastos del condominio con su evidencia) y Finanzas › Balance mensual.
import { useState } from 'react';
import { adminCall, type Schema } from '../api';
import { Empty, Field, Icon, Modal, fecha, hoy, money, periodoActual, useAction } from '../ui';
import { Firma } from './Firma';
import { ElegirArchivo } from '../ElegirArchivo';
import { useAdmin } from './AdminApp';
import { calcularBalance, evidenciasDe, mesAnterior, nombreMes, type DatosFinanzas, type Evidencia } from './balance';
import { CATEGORIAS_EGRESO, FONDO_AMENIDADES, MAX_EVIDENCIAS_EGRESO } from '../../../amplify/functions/shared/finanzas';

type Egreso = Schema['Egreso']['type'];

const FORMAS_PAGO = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Domiciliación'];

/** Selector de mes con flechas (anterior / siguiente). */
export function Mes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const siguiente = (() => {
    const [a, m] = value.split('-').map(Number);
    return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  })();
  return (
    <div className="row-actions" style={{ alignItems: 'center', gap: 6 }}>
      <button type="button" className="btn-app sm secondary" aria-label="Mes anterior" onClick={() => onChange(mesAnterior(value))}>
        ‹
      </button>
      <input type="month" className="input" style={{ maxWidth: 170 }} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button type="button" className="btn-app sm secondary" aria-label="Mes siguiente" onClick={() => onChange(siguiente)}>
        ›
      </button>
    </div>
  );
}

/** Enlace a un archivo de evidencia: admin-api firma la URL al tocarlo. */
export function VerEvidencia({ egresoId, ev }: { egresoId: string; ev: Evidencia }) {
  const { run } = useAction();
  const abrir = () =>
    run(async () => {
      const ventana = window.open('', '_blank');
      const { url } = await adminCall<{ url: string }>('egresos.evidencia', { id: egresoId, path: ev.path });
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    });
  return (
    <button type="button" className="linklike small" onClick={abrir} title={ev.nombre}>
      <Icon name="file" /> {ev.nombre.length > 28 ? `${ev.nombre.slice(0, 25)}…` : ev.nombre}
    </button>
  );
}

// ---------- Egresos ----------
export function EgresosAdmin({ datos, reload }: { datos: DatosFinanzas; reload: () => void }) {
  const { puede } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const [mes, setMes] = useState(periodoActual());
  const [editar, setEditar] = useState<Partial<Egreso> | null>(null);
  const { run } = useAction();
  const lista = datos.egresos.filter((e) => e.fecha.slice(0, 7) === mes).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const total = lista.reduce((s, e) => s + e.monto, 0);

  const borrar = (e: Egreso) =>
    confirm(`¿Eliminar el egreso "${e.concepto}" por ${money(e.monto)}?`) &&
    run(() => adminCall('egresos.borrar', { id: e.id }).then(reload), 'Egreso eliminado');

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Egresos de {nombreMes(mes)}</h2>
          {gestiona && (
            <button className="btn-app" onClick={() => setEditar({ fecha: mes === periodoActual() ? hoy() : `${mes}-01` })}>
              <Icon name="plus" />
              Registrar egreso
            </button>
          )}
        </div>
        <Mes value={mes} onChange={setMes} />
        {lista.length ? (
          <ul className="list" style={{ marginTop: 12 }}>
            {lista.map((e) => (
              <li key={e.id} style={{ alignItems: 'flex-start' }}>
                <div className="list-main">
                  <strong>
                    {e.concepto} · {money(e.monto)}
                  </strong>{' '}
                  {e.fondo === FONDO_AMENIDADES && <span className="badge">Fondo de amenidades</span>}
                  <div className="list-sub">
                    {fecha(e.fecha)} · {e.categoria}
                    {e.proveedor && ` · ${e.proveedor}`}
                    {e.formaPago && ` · ${e.formaPago}`}
                  </div>
                  <div className="row-actions" style={{ marginTop: 4, gap: 10 }}>
                    {evidenciasDe(e).map((ev) => (
                      <VerEvidencia key={ev.path} egresoId={e.id} ev={ev} />
                    ))}
                  </div>
                  <Firma item={e} altaAntes={e.registradoPorNombre || e.registradoPor} />
                </div>
                {gestiona && (
                  <div className="row-actions">
                    <button className="linklike" onClick={() => setEditar(e)}>
                      Editar
                    </button>
                    <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrar(e)}>
                      Eliminar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="money">Sin egresos registrados en {nombreMes(mes).toLowerCase()}.</Empty>
        )}
        {lista.length > 0 && (
          <p style={{ textAlign: 'right', margin: '12px 0 0' }}>
            <strong>Total del mes: {money(total)}</strong>
          </p>
        )}
      </section>
      {editar && (
        <EditarEgreso
          e={editar}
          onClose={() => setEditar(null)}
          onDone={(f) => {
            setEditar(null);
            setMes(f.slice(0, 7));
            reload();
          }}
        />
      )}
    </>
  );
}

type Archivo = { ev?: Evidencia; file?: File };

/** Alta o edición de un egreso. Con `fondo`, es un gasto pagado con el fondo de amenidades. */
export function EditarEgreso({ e, fondo, onClose, onDone }: { e: Partial<Egreso>; fondo?: boolean; onClose: () => void; onDone: (fecha: string) => void }) {
  const delFondo = fondo || e.fondo === FONDO_AMENIDADES;
  const { condoId } = useAdmin();
  const [f, setF] = useState({
    fecha: e.fecha ?? hoy(),
    categoria: e.categoria ?? '',
    concepto: e.concepto ?? '',
    proveedor: e.proveedor ?? '',
    formaPago: e.formaPago ?? '',
    monto: e.monto ? String(e.monto) : '',
  });
  const [archivos, setArchivos] = useState<Archivo[]>(() => (e.id ? evidenciasDe(e as Egreso).map((ev) => ({ ev })) : []));
  const { run, busy } = useAction();
  const lleno = archivos.length >= MAX_EVIDENCIAS_EGRESO;

  const agregar = (files: File[]) => {
    if (!files.length) return;
    const nuevos = files.slice(0, MAX_EVIDENCIAS_EGRESO - archivos.length).map((file) => ({ file }));
    if (files.length > nuevos.length) alert(`Máximo ${MAX_EVIDENCIAS_EGRESO} archivos de evidencia por egreso.`);
    setArchivos([...archivos, ...nuevos]);
  };

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    const okk = await run(async () => {
      if (!archivos.length) throw new Error('Sube al menos un archivo de evidencia (PDF o imagen).');
      const evidencias: Evidencia[] = [];
      for (const a of archivos) {
        if (a.ev) {
          evidencias.push(a.ev);
          continue;
        }
        const file = a.file!;
        const nombre = /\.[a-z0-9]+$/i.test(file.name) ? file.name : `${file.name || 'evidencia'}.${file.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
        const r = await adminCall<{ url: string; path: string; contentType: string }>('egresos.subirEvidencia', { condominioId: condoId, nombre, tamano: file.size });
        const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: file });
        if (!put.ok) throw new Error(`No se pudo subir ${file.name}. Intenta de nuevo.`);
        evidencias.push({ path: r.path, nombre: file.name || nombre });
      }
      await adminCall('egresos.guardar', { condominioId: condoId, id: e.id, ...f, monto: Number(f.monto), evidencias, fondo: delFondo ? FONDO_AMENIDADES : null });
    }, e.id ? 'Egreso actualizado' : 'Egreso registrado');
    if (okk) onDone(f.fecha);
  }

  return (
    <Modal title={delFondo ? (e.id ? 'Editar gasto del fondo de amenidades' : 'Gasto del fondo de amenidades') : e.id ? 'Editar egreso' : 'Registrar egreso'} onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        {delFondo && (
          <p className="small muted" style={{ margin: 0 }}>
            En qué se usó el ahorro de amenidades. Se descuenta del fondo, también cuenta como egreso del condominio y los residentes lo ven en su
            portal con su evidencia.
          </p>
        )}
        <div className="form-2">
          <Field label="Fecha del gasto">
            <input required type="date" value={f.fecha} onChange={(x) => setF({ ...f, fecha: x.target.value })} />
          </Field>
          <Field label="Categoría">
            <select required value={f.categoria} onChange={(x) => setF({ ...f, categoria: x.target.value })}>
              <option value="">Selecciona…</option>
              {CATEGORIAS_EGRESO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Concepto">
          <input required maxLength={200} value={f.concepto} onChange={(x) => setF({ ...f, concepto: x.target.value })} placeholder="Poda de áreas verdes, mantenimiento de cisterna…" />
        </Field>
        <div className="form-2">
          <Field label="Proveedor (opcional)">
            <input maxLength={120} value={f.proveedor} onChange={(x) => setF({ ...f, proveedor: x.target.value })} />
          </Field>
          <Field label="Forma de pago (opcional)">
            <select value={f.formaPago} onChange={(x) => setF({ ...f, formaPago: x.target.value })}>
              <option value="">—</option>
              {FORMAS_PAGO.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Monto (MXN)">
          <input required type="number" min="0.01" step="0.01" value={f.monto} onChange={(x) => setF({ ...f, monto: x.target.value })} />
        </Field>
        <Field grupo label={`Evidencia (de 1 a ${MAX_EVIDENCIAS_EGRESO} archivos)`} hint="Factura, nota, recibo o fotos del trabajo. PDF o imagen, máximo 10 MB cada uno.">
          <ElegirArchivo pdf multiple disabled={lleno} onChange={agregar} />
        </Field>
        {archivos.length > 0 && (
          <ul className="list">
            {archivos.map((a, k) => (
              <li key={k}>
                <span className="list-main small">
                  <Icon name="file" /> {a.ev?.nombre ?? a.file?.name}
                  {a.file && <span className="muted"> · {Math.max(1, Math.round(a.file.size / 1024))} KB · nuevo</span>}
                </span>
                <button type="button" className="linklike" style={{ color: 'var(--danger)' }} onClick={() => setArchivos(archivos.filter((_, i) => i !== k))}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="btn-app" disabled={busy || !archivos.length}>
          {busy ? 'Guardando…' : e.id ? 'Guardar cambios' : 'Registrar egreso'}
        </button>
      </form>
    </Modal>
  );
}

// ---------- Balance mensual ----------
export function BalanceMensual({ datos, reload }: { datos: DatosFinanzas; reload: () => void }) {
  const { condo, unidades, puede, firmaReporte } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const [mes, setMes] = useState(periodoActual());
  const [saldo, setSaldo] = useState(false);
  const { run, busy } = useAction();
  const b = calcularBalance(datos, mes);

  // El reporte (ExcelJS, logotipo y gráficas) se carga solo al descargarlo.
  const excel = () =>
    run(async () => {
      const { descargarReporteFinanzas } = await import('./reporteFinanzas');
      await descargarReporteFinanzas({ condominio: condo!.nombre, periodo: mes, datos, unidades, hoy: hoy(), generadoPor: firmaReporte });
    }, 'Estado financiero descargado');

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Balance de {nombreMes(mes)}</h2>
          <button className="btn-app secondary" disabled={busy} onClick={excel}>
            <Icon name="download" />
            {busy ? 'Generando…' : 'Estado financiero (Excel)'}
          </button>
        </div>
        <Mes value={mes} onChange={setMes} />
        <div className="grid-cards" style={{ marginTop: 14 }}>
          <div className="stat">
            <div className="stat-label">Saldo inicial</div>
            <div className="stat-value">{money(b.saldoInicial)}</div>
            <div className="small muted">{b.saldoCapturado ? 'Capturado manualmente' : 'Saldo final del mes anterior'}</div>
            {gestiona && (
              <button className="linklike" onClick={() => setSaldo(true)}>
                Editar saldo inicial
              </button>
            )}
          </div>
          <div className="stat">
            <div className="stat-label">Ingresos</div>
            <div className="stat-value is-ok">{money(b.totalIngresos)}</div>
            <div className="small muted">
              Ordinarios {money(b.totalOrdinarios)} · Amenidades {money(b.totalAmenidades)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Egresos</div>
            <div className="stat-value is-alert">{money(b.totalEgresos)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Saldo final</div>
            <div className={`stat-value ${b.saldoFinal < 0 ? 'is-alert' : ''}`}>{money(b.saldoFinal)}</div>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Ingresos</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            Comprobantes aprobados con fecha de pago en el mes ({b.pagosMes.length}).
          </p>
          <table className="tbl">
            <tbody>
              <tr>
                <td colSpan={2} className="small" style={{ color: 'var(--teal-dark)', fontWeight: 700 }}>
                  Ingresos ordinarios
                </td>
              </tr>
              {b.ordinarios.map((x) => (
                <tr key={x.tipo}>
                  <td>{x.label}</td>
                  <td className="num">{money(x.monto)}</td>
                </tr>
              ))}
              <tr>
                <td>Subtotal ordinarios</td>
                <td className="num">{money(b.totalOrdinarios)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="small" style={{ color: 'var(--teal-dark)', fontWeight: 700, paddingTop: 14 }}>
                  Ingresos por amenidades
                </td>
              </tr>
              {b.amenidades.length ? (
                b.amenidades.map((a) => (
                  <tr key={a.nombre}>
                    <td>
                      {a.nombre} <span className="small muted">· {a.reservas} reserva{a.reservas === 1 ? '' : 's'}</span>
                    </td>
                    <td className="num">{money(a.monto)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="muted">Sin reservas pagadas en el mes</td>
                  <td className="num">{money(0)}</td>
                </tr>
              )}
              <tr>
                <td>Subtotal amenidades</td>
                <td className="num">{money(b.totalAmenidades)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Total de ingresos</strong>
                </td>
                <td className="num">
                  <strong>{money(b.totalIngresos)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Egresos</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            Gastos registrados en el mes ({b.egresosMes.length}).
          </p>
          <table className="tbl">
            <tbody>
              {b.egresos
                .filter((x) => x.monto)
                .map((x) => (
                  <tr key={x.categoria}>
                    <td>{x.categoria}</td>
                    <td className="num">{money(x.monto)}</td>
                  </tr>
                ))}
              {!b.totalEgresos && (
                <tr>
                  <td className="muted">Sin egresos en el mes</td>
                  <td className="num">{money(0)}</td>
                </tr>
              )}
              <tr>
                <td>
                  <strong>Total de egresos</strong>
                </td>
                <td className="num">
                  <strong>{money(b.totalEgresos)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      {saldo && <EditarSaldo periodo={mes} actual={b.saldoInicial} capturado={!!b.saldoCapturado} nota={b.saldoCapturado?.nota} onClose={() => setSaldo(false)} onDone={() => (setSaldo(false), reload())} />}
    </>
  );
}

function EditarSaldo({ periodo, actual, capturado, nota, onClose, onDone }: { periodo: string; actual: number; capturado: boolean; nota?: string | null; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [monto, setMonto] = useState(String(actual));
  const [texto, setTexto] = useState(nota ?? '');
  const { run, busy } = useAction();
  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (await run(() => adminCall('saldos.inicial', { condominioId: condoId, periodo, saldoInicial: Number(monto), nota: texto }), 'Saldo inicial guardado')) onDone();
  };
  const arrastrar = async () => {
    if (await run(() => adminCall('saldos.inicial', { condominioId: condoId, periodo, saldoInicial: null }), 'El saldo inicial vuelve a tomarse del mes anterior')) onDone();
  };
  return (
    <Modal title={`Saldo inicial de ${nombreMes(periodo)}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <p className="small muted" style={{ margin: 0 }}>
          Normalmente es el saldo final del mes anterior. Captúralo a mano para el primer mes o para ajustarlo al saldo real del banco; los meses siguientes
          lo arrastran.
        </p>
        <Field label="Saldo inicial (MXN)">
          <input required type="number" step="0.01" value={monto} onChange={(x) => setMonto(x.target.value)} />
        </Field>
        <Field label="Nota (opcional)">
          <input maxLength={300} value={texto} onChange={(x) => setTexto(x.target.value)} placeholder="Saldo según estado de cuenta bancario" />
        </Field>
        <div className="row-actions">
          <button className="btn-app" disabled={busy}>
            Guardar
          </button>
          {capturado && (
            <button type="button" className="btn-app secondary" disabled={busy} onClick={arrastrar}>
              Tomar el saldo del mes anterior
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}


// Finanzas › Egresos (gastos del condominio con su evidencia) y Finanzas › Balance mensual.
import { useState, type ReactNode } from 'react';
import { adminCall, type Schema } from '../api';
import { Acciones, Datos, Empty, Field, Icon, Modal, Tarjeta, TarjetaIcono, Tarjetas, fecha, hoy, money, periodoActual, useAction } from '../ui';
import { Firma } from './Firma';
import { ElegirArchivo } from '../ElegirArchivo';
import { useAdmin } from './AdminApp';
import { calcularBalance, evidenciasDe, mesAnterior, nombreMes, type DatosFinanzas, type Evidencia, type FiltroIngreso } from './balance';
import { DetalleIngreso } from './DetalleIngreso';
import { CATEGORIAS_EGRESO, FONDO_AMENIDADES, MAX_EVIDENCIAS_EGRESO, apartadosDe, categoriasDe, nombreFondo } from '../../../amplify/functions/shared/finanzas';
import { BarraCategorias } from './Fondos';
import { AVISO_BLOQUEO, CamposMotivo, HistorialEdiciones, PedirMotivo, motivoVacio, useBloqueoEdicion, type Motivo } from './Ediciones';

type Egreso = Schema['Egreso']['type'];
type SaldoMensual = Schema['SaldoMensual']['type'];

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
  const { puede, condo } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const [mes, setMes] = useState(periodoActual());
  const [editar, setEditar] = useState<Partial<Egreso> | null>(null);
  const lista = datos.egresos.filter((e) => e.fecha.slice(0, 7) === mes).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const total = lista.reduce((s, e) => s + e.monto, 0);
  const [ficha, setFicha] = useState<string | null>(null);
  const fichaE = datos.egresos.find((e) => e.id === ficha);

  const [borrar, setBorrar] = useState<Egreso | null>(null);
  const bloqueado = useBloqueoEdicion();

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
          <div style={{ marginTop: 12 }}>
            <Tarjetas>
              {lista.map((e) => (
                <Tarjeta
                  key={e.id}
                  tono={evidenciasDe(e).length ? 'ok' : 'warn'}
                  onClick={() => setFicha(e.id)}
                  media={<TarjetaIcono name="file" />}
                  titulo={e.concepto}
                  sub={[fecha(e.fecha), e.categoria, e.proveedor, e.formaPago].filter(Boolean).join(' · ')}
                  lado={
                    <>
                      <strong>{money(e.monto)}</strong>
                      {e.fondo && <span className="badge">{nombreFondo(e.fondo, condo)}</span>}
                    </>
                  }
                />
              ))}
            </Tarjetas>
          </div>
        ) : (
          <Empty icon="money">Sin egresos registrados en {nombreMes(mes).toLowerCase()}.</Empty>
        )}
        {lista.length > 0 && (
          <p style={{ textAlign: 'right', margin: '12px 0 0' }}>
            <strong>Total del mes: {money(total)}</strong>
          </p>
        )}
      </section>
      {fichaE && (
        <Modal title={fichaE.concepto} onClose={() => setFicha(null)}>
          <div className="stack">
            <div className="row-actions">
              <strong>{money(fichaE.monto)}</strong>
              {fichaE.fondo && <span className="badge">{nombreFondo(fichaE.fondo, condo)}</span>}
            </div>
            <Datos
              items={[
                ['Fecha', fecha(fichaE.fecha)],
                ['Categoría', fichaE.categoria],
                ['Proveedor', fichaE.proveedor],
                ['Forma de pago', fichaE.formaPago],
              ]}
            />
            <div className="stack" style={{ gap: 6 }}>
              <span className="acciones-titulo">Evidencia</span>
              {evidenciasDe(fichaE).length ? (
                <div className="row-actions" style={{ gap: 10 }}>
                  {evidenciasDe(fichaE).map((ev) => (
                    <VerEvidencia key={ev.path} egresoId={fichaE.id} ev={ev} />
                  ))}
                </div>
              ) : (
                <span className="small muted">Sin evidencia.</span>
              )}
            </div>
            <Firma item={fichaE} altaAntes={fichaE.registradoPorNombre || fichaE.registradoPor} />
            <HistorialEdiciones item={fichaE} />
            {gestiona &&
              (bloqueado(fichaE) ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {AVISO_BLOQUEO}
                </p>
              ) : (
                <Acciones>
                  <button className="btn-app secondary" onClick={() => (setEditar(fichaE), setFicha(null))}>
                    Editar
                  </button>
                  <button className="btn-app danger" onClick={() => (setFicha(null), setBorrar(fichaE))}>
                    <Icon name="trash" />
                    Eliminar
                  </button>
                </Acciones>
              ))}
          </div>
        </Modal>
      )}
      {borrar && <EliminarEgreso e={borrar} onClose={() => setBorrar(null)} onDone={reload} />}
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

/** Eliminar un egreso o gasto del fondo: pide el motivo, que queda en la actividad. */
export function EliminarEgreso({ e, onClose, onDone }: { e: Egreso; onClose: () => void; onDone: () => void }) {
  return (
    <PedirMotivo
      titulo={e.fondo ? 'Eliminar salida del fondo' : 'Eliminar egreso'}
      texto={
        <>
          Se elimina <strong>{e.concepto}</strong> por {money(e.monto)}. El motivo queda en el registro de actividad con tu nombre.
        </>
      }
      boton="Eliminar"
      peligro
      onClose={onClose}
      onConfirmar={async (m) => {
        await adminCall('egresos.borrar', { id: e.id, ...m });
        onDone();
      }}
    />
  );
}

/**
 * Alta o edición de un egreso. Con `fondo` (clave de un fondo o apartado), es una salida de ese fondo: se descuenta de
 * su saldo y también cuenta como egreso del condominio. Sin `fondo`, la administración elige si se paga del saldo general
 * o de un fondo o apartado.
 */
export function EditarEgreso({ e, fondo, onClose, onDone }: { e: Partial<Egreso>; fondo?: string; onClose: () => void; onDone: (fecha: string) => void }) {
  const { condoId, condo } = useAdmin();
  const [deFondo, setDeFondo] = useState<string>(fondo ?? e.fondo ?? '');
  const fijo = !!fondo;
  const delFondo = !!deFondo;
  const opcionesFondo = [
    ...categoriasDe(condo).filter((c) => c.fondo).map((c) => ({ key: c.key, label: nombreFondo(c.key, condo)! })),
    ...apartadosDe(condo?.apartados)
      .filter((a) => a.activo || a.id === e.fondo)
      .map((a) => ({ key: a.id, label: `Apartado: ${a.nombre}` })),
  ];
  const [f, setF] = useState({
    fecha: e.fecha ?? hoy(),
    categoria: e.categoria ?? '',
    concepto: e.concepto ?? '',
    proveedor: e.proveedor ?? '',
    formaPago: e.formaPago ?? '',
    monto: e.monto ? String(e.monto) : '',
  });
  const [archivos, setArchivos] = useState<Archivo[]>(() => (e.id ? evidenciasDe(e as Egreso).map((ev) => ({ ev })) : []));
  const [m, setM] = useState<Motivo>(motivoVacio);
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
      await adminCall('egresos.guardar', { condominioId: condoId, id: e.id, ...f, monto: Number(f.monto), evidencias, fondo: deFondo || null, ...(e.id ? m : {}) });
    }, e.id ? 'Egreso actualizado' : 'Egreso registrado');
    if (okk) onDone(f.fecha);
  }

  return (
    <Modal
      title={fijo ? `${e.id ? 'Editar salida' : 'Salida'} · ${nombreFondo(deFondo, condo)}` : e.id ? 'Editar egreso' : 'Registrar egreso'}
      onClose={onClose}
      wide
    >
      <form className="form" onSubmit={guardar}>
        {!fijo && opcionesFondo.length > 0 && (
          <Field label="Se paga con" hint="Si se paga con un fondo (multas, amenidades, ahorro…) o un apartado, se descuenta de su saldo.">
            <select value={deFondo} onChange={(x) => setDeFondo(x.target.value)}>
              <option value="">Saldo general del condominio</option>
              {opcionesFondo.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {delFondo && (
          <p className="small muted" style={{ margin: 0 }}>
            {deFondo === FONDO_AMENIDADES
              ? 'En qué se usó el ahorro de amenidades. Se descuenta del fondo, también cuenta como egreso del condominio y los residentes lo ven en su portal con su evidencia.'
              : 'Salida con monto cerrado y comprobante: se descuenta del saldo del fondo o apartado y también cuenta como egreso del condominio.'}
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
        {e.id && (
          <>
            <CamposMotivo value={m} onChange={setM} />
            <div className="alert small" style={{ margin: 0 }}>
              El cambio queda registrado con tu nombre, la fecha, el motivo y lo que cambió. Después, solo un superadministrador puede volver a
              modificarlo.
            </div>
          </>
        )}
        <button className="btn-app" disabled={busy || !archivos.length}>
          {busy ? 'Guardando…' : e.id ? 'Guardar cambios' : 'Registrar egreso'}
        </button>
      </form>
    </Modal>
  );
}

// ---------- Balance mensual ----------
/** Fila de «Ingresos» que se toca para ver qué pagos la forman (sin monto, no se abre). */
function FilaIngreso({ monto, abrir, children }: { monto: number; abrir: () => void; children: ReactNode }) {
  if (!(monto > 0))
    return (
      <tr>
        <td>{children}</td>
        <td className="num">{money(monto)}</td>
      </tr>
    );
  return (
    <tr className="fila-tocable" tabIndex={0} role="button" onClick={abrir} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), abrir())}>
      <td>
        {children}
        <span className="fila-ver">Ver detalle</span>
      </td>
      <td className="num">
        {money(monto)}
        <Icon name="chevron-right" className="fila-flecha" />
      </td>
    </tr>
  );
}

export function BalanceMensual({ datos, reload }: { datos: DatosFinanzas; reload: () => void }) {
  const { condo, unidades, puede, firmaReporte } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const [mes, setMes] = useState(periodoActual());
  const [saldo, setSaldo] = useState(false);
  const { run, busy } = useAction();
  const b = calcularBalance(datos, mes);

  const [generando, setGenerando] = useState<'mensual' | 'anual' | null>(null);
  // Desglose de una fila de «Ingresos»: qué pagos forman ese monto.
  const [detalle, setDetalle] = useState<{ filtro: FiltroIngreso; titulo: string; color?: string } | null>(null);
  // El reporte (ExcelJS, logotipo y gráficas) se carga solo al descargarlo.
  const excel = () =>
    run(async () => {
      setGenerando('mensual');
      const { descargarReporteFinanzas } = await import('./reporteFinanzas');
      await descargarReporteFinanzas({ condominio: condo!.nombre, periodo: mes, datos, unidades, hoy: hoy(), generadoPor: firmaReporte });
    }, 'Balance mensual descargado');
  // Proyección anual: Excel de enero a diciembre (real hasta el mes elegido, proyectado después).
  const proyeccion = () =>
    run(async () => {
      setGenerando('anual');
      const [{ descargarProyeccionAnual }, contactos] = await Promise.all([
        import('./proyeccionAnual'),
        adminCall<Record<string, { nombre: string | null; email: string }[]>>('finanzas.contactos', { condominioId: condo!.id }).catch(() => ({})),
      ]);
      await descargarProyeccionAnual({
        condominio: condo!.nombre,
        hasta: mes,
        datos,
        cuotaMensual: condo!.cuotaMensual ?? 0,
        unidades,
        contactos,
        hoy: hoy(),
        tipoUnidad: condo!.tipoUnidad === 'DEPARTAMENTO' ? 'departamentos' : condo!.tipoUnidad ? 'casas' : undefined,
        generadoPor: firmaReporte,
      });
    }, 'Proyección anual descargada');
  const cuotas = b.pctCorriente + b.pctRecuperacion > 0;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Balance de {nombreMes(mes)}</h2>
          {/* Dos descargas separadas y de distinto color para que se vean a la primera. */}
          <div className="balance-botones">
            <button className="btn-app sm" disabled={busy} onClick={excel} title={`Estado financiero de ${nombreMes(mes).toLowerCase()} (Excel)`}>
              <Icon name="download" />
              {busy && generando === 'mensual' ? 'Generando…' : 'Mensual'}
            </button>
            <button
              className="btn-app sm btn-anual"
              disabled={busy}
              onClick={proyeccion}
              title={`Enero a diciembre de ${mes.slice(0, 4)}: real hasta ${nombreMes(mes).toLowerCase()} y proyectado (Excel)`}
            >
              <Icon name="chart" />
              {busy && generando === 'anual' ? 'Generando…' : 'Proyección anual'}
            </button>
          </div>
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
              {cuotas
                ? `Cuota corriente ${Math.round(b.pctCorriente * 100)}% · Recuperación ${Math.round(b.pctRecuperacion * 100)}%`
                : `Ordinarios ${money(b.totalOrdinarios)} · Amenidades ${money(b.totalAmenidades)}`}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Egresos</div>
            <div className="stat-value is-alert">{money(b.totalEgresos)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Saldo final</div>
            <div className={`stat-value ${b.saldoFinal < 0 ? 'is-alert' : ''}`}>{money(b.saldoFinal)}</div>
            {b.totalReservado > 0 && <div className="small muted">Fondos y apartados {money(b.totalReservado)}</div>}
          </div>
          <div className="stat stat-disponible">
            <div className="stat-label">Disponible para ejecutar</div>
            <div className="stat-value">{money(b.disponible)}</div>
            <div className="small">Saldo final menos fondos y apartados</div>
          </div>
        </div>
        {b.totalIngresos > 0 && (
          <div style={{ marginTop: 14 }}>
            <BarraCategorias items={b.categorias} total={b.totalIngresos} />
          </div>
        )}
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
                  Ingresos por categoría
                </td>
              </tr>
              {b.ordinarios.map((x) => (
                <FilaIngreso key={x.tipo} monto={x.monto} abrir={() => setDetalle({ filtro: { tipo: x.tipo }, titulo: x.label, color: x.color })}>
                  <span className="punto-cat" style={{ background: x.color }} />
                  {x.label}
                  {x.fondo && <span className="small muted"> · fondo</span>}
                </FilaIngreso>
              ))}
              <tr>
                <td>Subtotal sin amenidades</td>
                <td className="num">{money(b.totalOrdinarios)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="small" style={{ color: 'var(--teal-dark)', fontWeight: 700, paddingTop: 14 }}>
                  Ingresos por amenidades
                </td>
              </tr>
              {b.amenidades.length ? (
                b.amenidades.map((a) => (
                  <FilaIngreso key={a.nombre} monto={a.monto} abrir={() => setDetalle({ filtro: { amenidad: a.nombre }, titulo: a.nombre })}>
                    {a.nombre} <span className="small muted">· {a.reservas} reserva{a.reservas === 1 ? '' : 's'}</span>
                  </FilaIngreso>
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
      {(b.fondos.some((f) => f.saldo || f.ingresos || f.gastos) || b.apartados.length > 0) && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Fondos y apartados al cierre de {nombreMes(mes).toLowerCase()}</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            Se acumulan mes con mes y no cuentan como disponible para el gasto del mes. Se administran en Finanzas › Fondos y apartados.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Fondo o apartado</th>
                <th className="num">Entró en el mes</th>
                <th className="num">Salió en el mes</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {b.fondos.map((f) => (
                <tr key={f.key}>
                  <td>
                    <span className="punto-cat" style={{ background: f.color }} />
                    {f.label}
                  </td>
                  <td className="num">{money(f.ingresos)}</td>
                  <td className="num">{money(f.gastos)}</td>
                  <td className="num">{money(f.saldo)}</td>
                </tr>
              ))}
              {b.apartados.map((a) => (
                <tr key={a.id}>
                  <td>
                    Apartado: {a.nombre}
                    {!a.activo && <span className="small muted"> · archivado</span>}
                  </td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">{money(a.saldo)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total reservado</strong>
                </td>
                <td />
                <td />
                <td className="num">
                  <strong>{money(b.totalReservado)}</strong>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Disponible para ejecutar</strong> <span className="small muted">(saldo final {money(b.saldoFinal)} − reservado)</span>
                </td>
                <td />
                <td />
                <td className="num">
                  <strong>{money(b.disponible)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
      {saldo && <EditarSaldo periodo={mes} actual={b.saldoInicial} capturado={b.saldoCapturado} nota={b.saldoCapturado?.nota} onClose={() => setSaldo(false)} onDone={() => (setSaldo(false), reload())} />}
      {detalle && <DetalleIngreso datos={datos} mes={mes} filtro={detalle.filtro} titulo={detalle.titulo} color={detalle.color} onClose={() => setDetalle(null)} />}
    </>
  );
}

function EditarSaldo({ periodo, actual, capturado, nota, onClose, onDone }: { periodo: string; actual: number; capturado?: SaldoMensual; nota?: string | null; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [monto, setMonto] = useState(String(actual));
  const [texto, setTexto] = useState(nota ?? '');
  const [m, setM] = useState<Motivo>(motivoVacio);
  const { run, busy } = useAction();
  const bloqueado = useBloqueoEdicion()(capturado);
  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (await run(() => adminCall('saldos.inicial', { condominioId: condoId, periodo, saldoInicial: Number(monto), nota: texto, ...m }), 'Saldo inicial guardado')) onDone();
  };
  const arrastrar = async () => {
    if (!m.motivo) return alert('Elige el motivo del cambio.');
    if (await run(() => adminCall('saldos.inicial', { condominioId: condoId, periodo, saldoInicial: null, ...m }), 'El saldo inicial vuelve a tomarse del mes anterior')) onDone();
  };
  if (bloqueado)
    return (
      <Modal title={`Saldo inicial de ${nombreMes(periodo)}`} onClose={onClose}>
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {AVISO_BLOQUEO}
          </p>
          <HistorialEdiciones item={capturado!} />
        </div>
      </Modal>
    );
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
        {capturado && (
          <>
            <CamposMotivo value={m} onChange={setM} />
            <HistorialEdiciones item={capturado} />
          </>
        )}
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


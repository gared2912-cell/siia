// Finanzas › Fondos y apartados. Los «guardaditos» (multas y sanciones, amenidades, fondo de ahorro y las categorías
// propias marcadas como fondo) se acumulan mes con mes con lo que entra por su categoría y sus salidas (egresos con
// monto cerrado y comprobante). Los apartados son dinero que la administración separa a mano del saldo (macromedidor de
// agua, fondo de emergencia…). Fondos + apartados no cuentan como disponible para el gasto del mes:
// Disponible para ejecutar = saldo final − fondos − apartados. Aquí también se configuran las categorías de ingreso.
import { useState } from 'react';
import { adminCall } from '../api';
import { Datos, Empty, Field, Icon, Modal, Tarjeta, TarjetaIcono, Tarjetas, fecha, hoy, money, periodoActual, useAction } from '../ui';
import { useAdmin } from './AdminApp';
import { EditarEgreso, EliminarEgreso, VerEvidencia } from './Egresos';
import { calcularBalance, evidenciasDe, nombreMes, type DatosFinanzas } from './balance';
import {
  CATEGORIAS_INGRESO,
  FONDO_AMENIDADES,
  MAX_CATEGORIAS_PROPIAS,
  apartadosDe,
  calcularFondo,
  categoriasDe,
  categoriasPropias,
  nombreFondo,
  saldoApartado,
  type Apartado,
  type CategoriaIngreso,
} from '../../../amplify/functions/shared/finanzas';
import type { Schema } from '../api';

type Egreso = Schema['Egreso']['type'];

/** Barra de distribución del ingreso por categoría, con colores y su leyenda (monto y porcentaje). */
export function BarraCategorias({ items, total }: { items: (CategoriaIngreso & { monto: number })[]; total: number }) {
  const con = items.filter((c) => c.monto > 0);
  if (!total || !con.length) return null;
  return (
    <div className="barra-cat">
      <div className="barra-cat-barra" role="img" aria-label="Distribución de los ingresos del mes por categoría">
        {con.map((c) => (
          <span key={c.key} style={{ width: `${(c.monto / total) * 100}%`, background: c.color }} title={`${c.label}: ${money(c.monto)}`} />
        ))}
      </div>
      <ul className="barra-cat-leyenda">
        {con.map((c) => (
          <li key={c.key}>
            <span className="punto-cat" style={{ background: c.color }} />
            <span>{c.corto}</span>
            <strong>{money(c.monto)}</strong>
            <span className="muted">{Math.round((c.monto / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FondosAdmin({ datos, reload, onAmenidades }: { datos: DatosFinanzas; reload: () => void; onAmenidades: () => void }) {
  const { condo, puede, reloadCondos } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const mes = periodoActual();
  const b = calcularBalance(datos, mes);
  const cats = categoriasDe(condo);
  const apartados = apartadosDe(condo?.apartados);
  const [fondoAbierto, setFondoAbierto] = useState<string | null>(null);
  const [apartado, setApartado] = useState<Partial<Apartado> | null>(null);
  const [movimiento, setMovimiento] = useState<{ a: Apartado; signo: 1 | -1 } | null>(null);
  const [salida, setSalida] = useState<string | null>(null);
  const [categorias, setCategorias] = useState(false);
  const recargar = () => (reloadCondos(), reload());

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Disponible para ejecutar · {nombreMes(mes)}</h2>
        </div>
        <div className="grid-cards">
          <div className="stat">
            <div className="stat-label">Saldo final del mes</div>
            <div className="stat-value">{money(b.saldoFinal)}</div>
            <div className="small muted">Todo el dinero del condominio</div>
          </div>
          <div className="stat">
            <div className="stat-label">Fondos (guardaditos)</div>
            <div className="stat-value">{money(b.fondos.reduce((s, f) => s + Math.max(0, f.saldo), 0))}</div>
            <div className="small muted">{b.fondos.map((f) => f.label).join(', ')}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Apartados</div>
            <div className="stat-value">{money(b.apartados.reduce((s, a) => s + Math.max(0, a.saldo), 0))}</div>
            <div className="small muted">{apartados.length ? `${apartados.filter((a) => a.activo).length} activo(s)` : 'Sin apartados'}</div>
          </div>
          <div className="stat stat-disponible">
            <div className="stat-label">Disponible para ejecutar</div>
            <div className="stat-value">{money(b.disponible)}</div>
            <div className="small">Cuotas y demás ingresos, sin fondos ni apartados</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Fondos (guardaditos)</h2>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Lo que entra por estas categorías se acumula aquí mes con mes y no cuenta para el gasto del mes. Registra cada salida con su monto y comprobante: el
          sistema descuenta el saldo.
        </p>
        <Tarjetas>
          {cats
            .filter((c) => c.fondo)
            .map((c) => {
              const f = calcularFondo(datos, c.key, mes);
              return (
                <Tarjeta
                  key={c.key}
                  tono={f.saldo < 0 ? 'mal' : 'info'}
                  onClick={() => (c.key === FONDO_AMENIDADES ? onAmenidades() : setFondoAbierto(c.key))}
                  media={<span className="tile-icon" style={{ width: 36, height: 36, background: c.color, color: '#fff' }}><Icon name="money" /></span>}
                  titulo={c.label}
                  sub={`Entró ${money(f.totalIngresos)} · salió ${money(f.totalGastos)}${c.key === FONDO_AMENIDADES ? ' · se administra en Ingresos › Amenidades' : ''}`}
                  lado={<strong>{money(f.saldo)}</strong>}
                />
              );
            })}
        </Tarjetas>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Apartados</h2>
          {gestiona && (
            <button className="btn-app" onClick={() => setApartado({})}>
              <Icon name="plus" />
              Nuevo apartado
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Dinero que se separa a mano del saldo para algo específico (p. ej. macromedidor de agua, fondo de emergencia). Se resta de lo disponible hasta que se
          libera o se gasta.
        </p>
        {apartados.length ? (
          <Tarjetas>
            {apartados.map((a) => {
              const s = saldoApartado(a, datos.egresos, '9999-12');
              return (
                <Tarjeta
                  key={a.id}
                  tono={a.activo ? 'ok' : 'neutro'}
                  onClick={() => setApartado(a)}
                  media={<TarjetaIcono name="shield" />}
                  titulo={`${a.nombre}${a.activo ? '' : ' (archivado)'}`}
                  sub={`Apartado ${money(s.apartado)} · gastado ${money(s.gastado)}${a.descripcion ? ` · ${a.descripcion}` : ''}`}
                  lado={<strong>{money(s.saldo)}</strong>}
                />
              );
            })}
          </Tarjetas>
        ) : (
          <Empty icon="shield">Sin apartados. Usa «Nuevo apartado» para separar dinero del saldo.</Empty>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Categorías de ingreso</h2>
          {gestiona && (
            <button className="btn-app secondary" onClick={() => setCategorias(true)}>
              <Icon name="settings" />
              Configurar
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Cada pago aprobado se reparte en estas categorías (automático por cargo y fecha, o con «Desglosar» al aprobar). Las marcadas como fondo son guardaditos.
        </p>
        <ul className="list">
          {cats.map((c) => (
            <li key={c.key}>
              <span className="list-main">
                <span>
                  <span className="punto-cat" style={{ background: c.color }} />
                  <strong>{c.label}</strong>
                </span>
                <span className="list-sub">{[c.fondo ? 'Fondo acumulable' : 'Disponible para el gasto del mes', c.propia ? 'Propia del condominio' : null].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {fondoAbierto && (
        <FichaFondo
          clave={fondoAbierto}
          datos={datos}
          gestiona={gestiona}
          onClose={() => setFondoAbierto(null)}
          onSalida={() => (setSalida(fondoAbierto), setFondoAbierto(null))}
          reload={reload}
        />
      )}
      {apartado && (
        <FichaApartado
          a={apartado}
          datos={datos}
          gestiona={gestiona}
          onClose={() => setApartado(null)}
          onMovimiento={(signo) => (setMovimiento({ a: apartado as Apartado, signo }), setApartado(null))}
          onSalida={() => (setSalida(apartado.id!), setApartado(null))}
          onDone={() => (setApartado(null), recargar())}
          reload={reload}
        />
      )}
      {movimiento && <Movimiento a={movimiento.a} signo={movimiento.signo} onClose={() => setMovimiento(null)} onDone={() => (setMovimiento(null), recargar())} />}
      {salida && (
        <EditarEgreso
          e={{ fecha: hoy() }}
          fondo={salida}
          onClose={() => setSalida(null)}
          onDone={() => {
            setSalida(null);
            reload();
          }}
        />
      )}
      {categorias && <ConfigurarCategorias onClose={() => setCategorias(false)} onDone={() => (setCategorias(false), recargar())} />}
    </>
  );
}

/** Salidas de un fondo o apartado (egresos con fondo = clave), de la más reciente a la más antigua. */
function Salidas({ clave, datos, gestiona, reload }: { clave: string; datos: DatosFinanzas; gestiona: boolean; reload: () => void }) {
  const [borrar, setBorrar] = useState<Egreso | null>(null);
  const lista = datos.egresos.filter((e) => e.fondo === clave).sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!lista.length) return <p className="small muted">Sin salidas registradas.</p>;
  return (
    <>
      <ul className="list">
        {lista.map((e) => (
          <li key={e.id}>
            <span className="list-main">
              <strong>{e.concepto}</strong>
              <span className="list-sub">
                {fecha(e.fecha)} · {e.categoria}
                {e.proveedor ? ` · ${e.proveedor}` : ''}
              </span>
              <span className="row-actions" style={{ gap: 8 }}>
                {evidenciasDe(e).map((ev) => (
                  <VerEvidencia key={ev.path} egresoId={e.id} ev={ev} />
                ))}
              </span>
            </span>
            <span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
              <strong>{money(e.monto)}</strong>
              {gestiona && (
                <button className="linklike small" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(e)}>
                  Eliminar
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {borrar && <EliminarEgreso e={borrar} onClose={() => setBorrar(null)} onDone={reload} />}
    </>
  );
}

function FichaFondo({ clave, datos, gestiona, onClose, onSalida, reload }: { clave: string; datos: DatosFinanzas; gestiona: boolean; onClose: () => void; onSalida: () => void; reload: () => void }) {
  const { condo } = useAdmin();
  const f = calcularFondo(datos, clave, periodoActual());
  const recientes = [...f.meses].reverse().slice(0, 12);
  return (
    <Modal title={nombreFondo(clave, condo) ?? 'Fondo'} onClose={onClose} wide>
      <div className="stack">
        <Datos
          items={[
            ['Saldo actual', money(f.saldo)],
            ['Total que ha entrado', money(f.totalIngresos)],
            ['Total de salidas', money(f.totalGastos)],
            ['Desde', nombreMes(f.desde)],
          ]}
        />
        {gestiona && (
          <div>
            <button className="btn-app" onClick={onSalida}>
              <Icon name="plus" />
              Registrar salida
            </button>
          </div>
        )}
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Mes por mes</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Inicial</th>
              <th className="num">Entró</th>
              <th className="num">Salió</th>
              <th className="num">Final</th>
            </tr>
          </thead>
          <tbody>
            {recientes.map((m) => (
              <tr key={m.periodo}>
                <td>{nombreMes(m.periodo)}</td>
                <td className="num">{money(m.inicial)}</td>
                <td className="num">{money(m.ingresos)}</td>
                <td className="num">{money(m.gastos)}</td>
                <td className="num">{money(m.final)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Salidas</h3>
        <Salidas clave={clave} datos={datos} gestiona={gestiona} reload={reload} />
      </div>
    </Modal>
  );
}

function FichaApartado({
  a,
  datos,
  gestiona,
  onClose,
  onMovimiento,
  onSalida,
  onDone,
  reload,
}: {
  a: Partial<Apartado>;
  datos: DatosFinanzas;
  gestiona: boolean;
  onClose: () => void;
  onMovimiento: (signo: 1 | -1) => void;
  onSalida: () => void;
  onDone: () => void;
  reload: () => void;
}) {
  const { condoId } = useAdmin();
  const nuevo = !a.id;
  const [editar, setEditar] = useState(nuevo);
  const [f, setF] = useState({ nombre: a.nombre ?? '', descripcion: a.descripcion ?? '' });
  const { run, busy } = useAction();
  const guardar = async (activo = a.activo !== false) => {
    if (await run(() => adminCall('apartados.guardar', { condominioId: condoId, id: a.id, ...f, activo }), nuevo ? 'Apartado creado' : 'Apartado actualizado')) onDone();
  };
  const s = a.id ? saldoApartado(a as Apartado, datos.egresos, '9999-12') : null;
  return (
    <Modal title={nuevo ? 'Nuevo apartado' : a.nombre!} onClose={onClose} wide={!nuevo}>
      <div className="stack">
        {editar ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              guardar();
            }}
          >
            <Field label="Nombre">
              <input required maxLength={80} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Macromedidor de agua, fondo de emergencia…" />
            </Field>
            <Field label="Descripción (opcional)">
              <input maxLength={300} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
            </Field>
            <button className="btn-app" disabled={busy}>
              {busy ? 'Guardando…' : nuevo ? 'Crear apartado' : 'Guardar'}
            </button>
          </form>
        ) : (
          <>
            <Datos
              items={[
                ['Saldo', money(s!.saldo)],
                ['Apartado (neto)', money(s!.apartado)],
                ['Gastado', money(s!.gastado)],
                ['Descripción', a.descripcion],
                ['Estado', a.activo ? 'Activo' : 'Archivado'],
              ]}
            />
            {gestiona && (
              <div className="row-actions">
                <button className="btn-app" onClick={() => onMovimiento(1)}>
                  <Icon name="plus" />
                  Apartar dinero
                </button>
                <button className="btn-app secondary" disabled={!(s!.saldo > 0)} onClick={() => onMovimiento(-1)}>
                  Liberar
                </button>
                <button className="btn-app secondary" disabled={!(s!.saldo > 0)} onClick={onSalida}>
                  Registrar salida
                </button>
                <button className="btn-app secondary" onClick={() => setEditar(true)}>
                  Editar
                </button>
                <button className="btn-app secondary" disabled={busy} onClick={() => guardar(!a.activo)}>
                  {a.activo ? 'Archivar' : 'Reactivar'}
                </button>
              </div>
            )}
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Movimientos</h3>
            {a.movimientos?.length ? (
              <ul className="list">
                {[...a.movimientos].reverse().map((m) => (
                  <li key={m.id}>
                    <span className="list-main">
                      <strong>{m.monto > 0 ? 'Se apartó' : 'Se liberó'}</strong>
                      <span className="list-sub">
                        {fecha(m.fecha)}
                        {m.nota ? ` · ${m.nota}` : ''}
                        {m.porNombre ? ` · ${m.porNombre}` : ''}
                      </span>
                    </span>
                    <strong style={{ color: m.monto > 0 ? undefined : 'var(--danger)' }}>{money(m.monto)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Aún no se aparta dinero.</p>
            )}
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Salidas</h3>
            <Salidas clave={a.id!} datos={datos} gestiona={gestiona} reload={reload} />
          </>
        )}
      </div>
    </Modal>
  );
}

function Movimiento({ a, signo, onClose, onDone }: { a: Apartado; signo: 1 | -1; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({ monto: '', fecha: hoy(), nota: '' });
  const { run, busy } = useAction();
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const datos = { condominioId: condoId, id: a.id, monto: signo * Math.abs(Number(f.monto)), fecha: f.fecha, nota: f.nota };
    if (await run(() => adminCall('apartados.movimiento', datos), signo > 0 ? 'Dinero apartado' : 'Dinero liberado')) onDone();
  };
  return (
    <Modal title={`${signo > 0 ? 'Apartar dinero' : 'Liberar dinero'} · ${a.nombre}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <p className="small muted" style={{ margin: 0 }}>
          {signo > 0
            ? 'Se separa del saldo del condominio: deja de contar como disponible para ejecutar.'
            : 'Vuelve a contar como disponible para ejecutar (si se gastó, mejor registra la salida con su comprobante).'}
        </p>
        <div className="form-2">
          <Field label="Monto (MXN)">
            <input required type="number" min="0.01" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} />
          </Field>
          <Field label="Fecha">
            <input required type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
          </Field>
        </div>
        <Field label="Nota">
          <input required maxLength={300} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder={signo > 0 ? 'Para qué se aparta' : 'Por qué se libera'} />
        </Field>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : signo > 0 ? 'Apartar' : 'Liberar'}
        </button>
      </form>
    </Modal>
  );
}

function ConfigurarCategorias({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condo, condoId } = useAdmin();
  const [lista, setLista] = useState(() => categoriasPropias(condo?.categoriasIngreso).map((c) => ({ key: c.key as string | undefined, label: c.label, fondo: c.fondo })));
  const { run, busy } = useAction();
  const cambia = (i: number, x: Partial<(typeof lista)[number]>) => setLista(lista.map((c, k) => (k === i ? { ...c, ...x } : c)));
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => adminCall('finanzas.categorias', { condominioId: condoId, categorias: lista }), 'Categorías guardadas')) onDone();
  };
  return (
    <Modal title="Categorías de ingreso" onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        <p className="small muted" style={{ margin: 0 }}>
          Las del sistema siempre están: {CATEGORIAS_INGRESO.map((c) => c.label).join(', ')}. Agrega las propias del condominio (p. ej. «Renta de salón», «Cuota de
          pintura 2026»). Las que marques como fondo se acumulan como guardadito.
        </p>
        {lista.map((c, i) => (
          <div key={c.key ?? `n${i}`} className="fila-desglose">
            <input required maxLength={60} value={c.label} onChange={(e) => cambia(i, { label: e.target.value })} placeholder="Nombre de la categoría" aria-label="Nombre" />
            <label className="check" style={{ whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={c.fondo} onChange={(e) => cambia(i, { fondo: e.target.checked })} />
              Es fondo
            </label>
            <button type="button" className="icon-btn" aria-label="Quitar" onClick={() => setLista(lista.filter((_, k) => k !== i))}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        {lista.length < MAX_CATEGORIAS_PROPIAS && (
          <div>
            <button type="button" className="btn-app sm secondary" onClick={() => setLista([...lista, { key: undefined, label: '', fondo: false }])}>
              <Icon name="plus" />
              Agregar categoría
            </button>
          </div>
        )}
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar categorías'}
        </button>
      </form>
    </Modal>
  );
}

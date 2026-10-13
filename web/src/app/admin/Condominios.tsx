import { useState } from 'react';
import { db, ok } from '../api';
import { Badge, Empty, Field, Icon, MODULOS, Modal, PageHead, money, useAction } from '../ui';
import { useAdmin, type Condominio, type Unidad } from './AdminApp';

const TIPOS = ['Condominio horizontal', 'Condominio vertical (edificio)', 'Fraccionamiento cerrado', 'Uso mixto / otro'];

export function Condominios() {
  const { condos, condo, setCondoId, reloadCondos, puede, tiene } = useAdmin();
  const [editar, setEditar] = useState<Partial<Condominio> | null>(null);
  const gestiona = puede('condominios', 'editar');

  return (
    <div className="stack">
      <PageHead icon="building" title="Condominios" sub="Alta de condominios, servicios autorizados y unidades.">
        {gestiona && tiene('condominios.alta') && (
          <button className="btn-app" onClick={() => setEditar({ modulos: [], activo: true })}>
            <Icon name="plus" />
            Nuevo condominio
          </button>
        )}
      </PageHead>

      {condos.length ? (
        <div className="grid-cards">
          {condos.map((c) => (
            <article key={c.id} className="panel" style={{ marginTop: 0, borderColor: c.id === condo?.id ? 'var(--teal)' : undefined }}>
              <div className="panel-head">
                <h3>{c.nombre}</h3>
                <Badge estado={c.activo === false ? 'SUSPENDIDO' : 'APROBADO'}>{c.activo === false ? 'Inactivo' : 'Activo'}</Badge>
              </div>
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                {c.tipo ?? 'Sin tipo'} {c.direccion && `· ${c.direccion}`}
              </p>
              <p className="small" style={{ margin: '0 0 12px' }}>
                <strong>{(c.modulos ?? []).length}</strong> de {MODULOS.length} servicios autorizados
              </p>
              <div className="row-actions">
                {(gestiona || tiene('condominios.servicios') || tiene('condominios.datosPago')) && (
                  <button className="btn-app sm secondary" onClick={() => setEditar(c)}>
                    {tiene('condominios.servicios') ? 'Editar y servicios' : 'Editar'}
                  </button>
                )}
                {c.id !== condo?.id && (
                  <button className="btn-app sm secondary" onClick={() => setCondoId(c.id)}>
                    Ver unidades
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty icon="building">{tiene('condominios.alta') ? 'Da de alta el primer condominio.' : 'No tienes condominios asignados.'}</Empty>
        </section>
      )}

      {condo && <Unidades />}

      {editar && (
        <EditarCondominio
          c={editar}
          onClose={() => setEditar(null)}
          onDone={(id) => {
            setEditar(null);
            reloadCondos();
            if (id) setCondoId(id);
          }}
        />
      )}
    </div>
  );
}

function EditarCondominio({ c, onClose, onDone }: { c: Partial<Condominio>; onClose: () => void; onDone: (id?: string) => void }) {
  const { tiene, puede } = useAdmin();
  // Datos generales con «Gestionar»; servicios y datos bancarios con su permiso especial.
  const generales = puede('condominios', 'editar');
  const servicios = tiene('condominios.servicios');
  const banco = tiene('condominios.datosPago');
  const [f, setF] = useState({
    nombre: c.nombre ?? '',
    tipo: c.tipo ?? TIPOS[0],
    direccion: c.direccion ?? '',
    datosPago: c.datosPago ?? '',
    telefonoCaseta: c.telefonoCaseta ?? '',
    activo: c.activo !== false,
    modulos: (c.modulos ?? []).filter(Boolean) as string[],
  });
  const { run, busy } = useAction();
  const set =
    (k: 'nombre' | 'tipo' | 'direccion' | 'datosPago' | 'telefonoCaseta') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });
  const toggle = (m: string) => setF({ ...f, modulos: f.modulos.includes(m) ? f.modulos.filter((x) => x !== m) : [...f.modulos, m] });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    let id: string | undefined;
    const okk = await run(
      async () => {
        const r = c.id ? ok(await db.models.Condominio.update({ id: c.id, ...f })) : ok(await db.models.Condominio.create(f));
        id = r?.id;
      },
      c.id ? 'Condominio actualizado' : 'Condominio creado',
    );
    if (okk) onDone(id);
  }

  return (
    <Modal title={c.id ? `Editar ${c.nombre}` : 'Nuevo condominio'} onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label="Nombre">
            <input required maxLength={120} value={f.nombre} onChange={set('nombre')} disabled={!generales} />
          </Field>
          <Field label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} disabled={!generales}>
              {TIPOS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Dirección">
            <input maxLength={200} value={f.direccion} onChange={set('direccion')} disabled={!generales} />
          </Field>
          <Field label="Teléfono de caseta">
            <input type="tel" maxLength={20} value={f.telefonoCaseta} onChange={set('telefonoCaseta')} disabled={!generales} />
          </Field>
        </div>
        <Field
          label="Datos para pago de cuotas"
          hint={
            banco
              ? 'Se muestran a los residentes en Finanzas (banco, CLABE, beneficiario, referencia).'
              : 'Tu rol no permite editar los datos bancarios.'
          }
        >
          <textarea maxLength={1000} value={f.datosPago} onChange={set('datosPago')} disabled={!banco} />
        </Field>
        <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Servicios autorizados para los residentes</span>
          <small>
            {servicios ? 'Solo los servicios marcados aparecen en el portal de este condominio.' : 'Tu rol no permite cambiar los servicios.'}
          </small>
          <div className="checks" style={{ marginTop: 6 }}>
            {MODULOS.map((m) => (
              <label key={m.key} className="check">
                <input type="checkbox" disabled={!servicios} checked={f.modulos.includes(m.key)} onChange={() => toggle(m.key)} />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input type="checkbox" disabled={!servicios} checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
          Portal activo (si se desactiva, ningún residente ni vigilante de este condominio puede entrar)
        </label>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </Modal>
  );
}

function Unidades() {
  const { condo, unidades, reloadUnidades, puede } = useAdmin();
  const gestiona = puede('condominios', 'editar');
  const [editar, setEditar] = useState<Partial<Unidad> | null>(null);
  const [lote, setLote] = useState(false);
  const { run } = useAction();

  const borrar = (u: Unidad) =>
    confirm(`¿Eliminar ${u.etiqueta}? Sus cargos e historial se conservan pero quedarán sin unidad.`) &&
    run(async () => {
      ok(await db.models.Unidad.delete({ id: u.id }));
      reloadUnidades();
    }, 'Unidad eliminada');

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Unidades de {condo!.nombre}</h2>
        {gestiona && (
          <div className="row-actions">
            <button className="btn-app sm secondary" onClick={() => setLote(true)}>
              Alta masiva
            </button>
            <button className="btn-app sm" onClick={() => setEditar({})}>
              <Icon name="plus" />
              Unidad
            </button>
          </div>
        )}
      </div>
      {unidades.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Unidad</th>
                <th>Propietario</th>
                <th className="num">Cuota mensual</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unidades.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.etiqueta}</strong>
                  </td>
                  <td>{u.propietario ?? '—'}</td>
                  <td className="num">{u.cuota != null ? money(u.cuota) : '—'}</td>
                  <td>
                    {gestiona && (
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="linklike" onClick={() => setEditar(u)}>
                          Editar
                        </button>
                        <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrar(u)}>
                          Eliminar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="building">Da de alta las casas o departamentos del condominio.</Empty>
      )}
      {editar && <EditarUnidad u={editar} onClose={() => setEditar(null)} onDone={() => (setEditar(null), reloadUnidades())} />}
      {lote && <AltaMasiva onClose={() => setLote(false)} onDone={() => (setLote(false), reloadUnidades())} />}
    </section>
  );
}

function EditarUnidad({ u, onClose, onDone }: { u: Partial<Unidad>; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({
    etiqueta: u.etiqueta ?? '',
    propietario: u.propietario ?? '',
    cuota: u.cuota != null ? String(u.cuota) : '',
    notas: u.notas ?? '',
  });
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = {
      etiqueta: f.etiqueta.trim(),
      propietario: f.propietario || null,
      cuota: f.cuota === '' ? null : Number(f.cuota),
      notas: f.notas || null,
    };
    const okk = await run(async () => {
      if (u.id) ok(await db.models.Unidad.update({ id: u.id, ...datos }));
      else ok(await db.models.Unidad.create({ condominioId: condoId, ...datos }));
    }, 'Unidad guardada');
    if (okk) onDone();
  }
  return (
    <Modal title={u.id ? `Editar ${u.etiqueta}` : 'Nueva unidad'} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label="Identificador">
            <input
              required
              maxLength={60}
              value={f.etiqueta}
              onChange={(e) => setF({ ...f, etiqueta: e.target.value })}
              placeholder="Casa 12 / Depto 3B"
            />
          </Field>
          <Field label="Cuota mensual (MXN)">
            <input type="number" min="0" step="0.01" value={f.cuota} onChange={(e) => setF({ ...f, cuota: e.target.value })} />
          </Field>
        </div>
        <Field label="Propietario">
          <input maxLength={120} value={f.propietario} onChange={(e) => setF({ ...f, propietario: e.target.value })} />
        </Field>
        <Field label="Notas">
          <textarea maxLength={500} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} />
        </Field>
        <button className="btn-app" disabled={busy}>
          Guardar
        </button>
      </form>
    </Modal>
  );
}

function AltaMasiva({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condoId, unidades } = useAdmin();
  const [f, setF] = useState({ prefijo: 'Casa ', desde: '1', hasta: '20', cuota: '' });
  const { run, busy } = useAction();
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const desde = Number(f.desde);
    const hasta = Number(f.hasta);
    const existentes = new Set(unidades.map((u) => u.etiqueta));
    const nuevas: string[] = [];
    for (let i = desde; i <= hasta && nuevas.length < 500; i++) {
      const etiqueta = `${f.prefijo}${i}`.trim();
      if (!existentes.has(etiqueta)) nuevas.push(etiqueta);
    }
    const okk = await run(async () => {
      if (!nuevas.length) throw new Error('Todas esas unidades ya existen.');
      const cuota = f.cuota === '' ? null : Number(f.cuota);
      for (let i = 0; i < nuevas.length; i += 10) {
        await Promise.all(
          nuevas.slice(i, i + 10).map(async (etiqueta) => ok(await db.models.Unidad.create({ condominioId: condoId, etiqueta, cuota }))),
        );
      }
    }, `${nuevas.length} unidades creadas`);
    if (okk) onDone();
  }
  return (
    <Modal title="Alta masiva de unidades" onClose={onClose}>
      <form className="form" onSubmit={crear}>
        <div className="form-2">
          <Field label="Prefijo">
            <input value={f.prefijo} onChange={(e) => setF({ ...f, prefijo: e.target.value })} />
          </Field>
          <Field label="Cuota mensual (MXN)">
            <input type="number" min="0" step="0.01" value={f.cuota} onChange={(e) => setF({ ...f, cuota: e.target.value })} />
          </Field>
          <Field label="Desde el número">
            <input required type="number" min="0" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
          </Field>
          <Field label="Hasta el número">
            <input required type="number" min="0" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
          </Field>
        </div>
        <p className="small muted">
          Se crearán: {f.prefijo}
          {f.desde} … {f.prefijo}
          {f.hasta}. Las que ya existan se omiten.
        </p>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Creando…' : 'Crear unidades'}
        </button>
      </form>
    </Modal>
  );
}

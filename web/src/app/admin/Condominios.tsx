// Condominios: cada condominio tiene su ficha con todo lo suyo — datos generales, cuota y datos de pago,
// cuotas extraordinarias, unidades y residentes (uno por uno o con el machote de Excel), amenidades y servicios.
import { useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { Acciones, Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, MODULOS, Modal, PageHead, Seg, Tarjeta, TarjetaIcono, Tarjetas, fecha, hoy, money, useAction, useLoad } from '../ui';
import { TIPOS_UNIDAD, prefijoUnidad, textoDatosPago } from '../../../amplify/functions/shared/unidades';
import { useAdmin, type Condominio } from './AdminApp';
import { Residentes } from './Residentes';
import { Documentos } from './Documentos';
import { CatalogoAmenidades } from './Operacion';
import { TipoIngreso } from './FinanzasAdmin';
import { Firma } from './Firma';
import { AdminsCondominio } from './AdminsCondominio';
import { AvisoSuspendido, Papelera, ZonaCondominio } from './EstadoCondominio';

type Cargo = Schema['Cargo']['type'];
type Tab = 'general' | 'cuotas' | 'residentes' | 'amenidades' | 'servicios';

// Servicios que entran al condominio; la caseta avisa a todos los residentes cuando llegan.
const SERVICIOS_SUGERIDOS = ['Basura', 'Gas', 'Agua (pipa)', 'Mantenimiento', 'Administración', 'Rondín de supervisión', 'Jardinería'];
const TIPOS = ['Condominio horizontal', 'Condominio vertical (edificio)', 'Fraccionamiento cerrado', 'Uso mixto / otro'];
const nombreTipoUnidad = (t?: string | null) => (t === 'DEPARTAMENTO' ? 'Departamentos' : t === 'CASA' ? 'Casas' : 'Sin definir');

/** `inicio`: abre directo la ficha del condominio seleccionado en esa pestaña (acceso directo del Panel). */
export function Condominios({ inicio }: { inicio?: Tab } = {}) {
  const { condos, condo, setCondoId, puede, tiene, superadmin } = useAdmin();
  const [vista, setVista] = useState<'lista' | 'ficha' | 'nuevo' | 'papelera'>(() => (inicio ? 'ficha' : 'lista'));
  const [tab, setTab] = useState<Tab>(inicio ?? 'general');
  const alta = puede('condominios', 'editar') && tiene('condominios.alta');

  if (vista === 'nuevo')
    return (
      <NuevoCondominio
        onCancel={() => setVista('lista')}
        onDone={(id) => {
          setCondoId(id);
          setTab('residentes');
          setVista('ficha');
        }}
      />
    );
  if (vista === 'ficha') return condo ? <Ficha tab={tab} setTab={setTab} onBack={() => setVista('lista')} /> : <Loading />;
  if (vista === 'papelera' && superadmin) return <Papelera onBack={() => setVista('lista')} />;

  return (
    <div className="stack">
      <PageHead icon="building" title="Condominios" sub="Cada condominio con sus datos, cuotas, residentes, amenidades y servicios.">
        {superadmin && (
          <button className="btn-app secondary" onClick={() => setVista('papelera')}>
            <Icon name="trash" />
            Papelera
          </button>
        )}
        {alta && (
          <button className="btn-app" onClick={() => setVista('nuevo')}>
            <Icon name="plus" />
            Nuevo condominio
          </button>
        )}
      </PageHead>
      {condos.length ? (
        <Tarjetas>
          {condos.map((c) => (
            <Tarjeta
              key={c.id}
              tono={c.suspendido ? 'mal' : c.activo === false ? 'neutro' : 'ok'}
              onClick={() => {
                setCondoId(c.id);
                setTab('general');
                setVista('ficha');
              }}
              label={`Abrir ${c.nombre}`}
              media={<TarjetaIcono name="building" />}
              titulo={c.nombre}
              sub={
                <>
                  {c.tipo ?? 'Sin tipo'} · {nombreTipoUnidad(c.tipoUnidad)}
                  {c.direccion && <> · {c.direccion}</>}
                  <br />
                  Cuota: <strong>{c.cuotaMensual ? `${money(c.cuotaMensual)} al mes` : 'sin definir'}</strong>
                  {c.cuotaAutomatica && ` (automática el día ${c.diaCargo ?? 1})`} · {(c.modulos ?? []).length} de {MODULOS.length} servicios
                </>
              }
              lado={
                c.suspendido ? (
                  <Badge estado="SUSPENDIDO">Suspendido</Badge>
                ) : (
                  <Badge estado={c.activo === false ? 'CANCELADO' : 'APROBADO'}>{c.activo === false ? 'Inactivo' : 'Activo'}</Badge>
                )
              }
            />
          ))}
        </Tarjetas>
      ) : (
        <section className="panel">
          <Empty icon="building">{alta ? 'Da de alta el primer condominio.' : 'No tienes condominios asignados.'}</Empty>
        </section>
      )}
    </div>
  );
}

function Ficha({ tab, setTab, onBack }: { tab: Tab; setTab: (t: Tab) => void; onBack: () => void }) {
  const { condo, unidades, puede, superadmin } = useAdmin();
  const c = condo!;
  // Suspendido: sus administradores solo ven el aviso; el superadministrador trabaja normal.
  if (c.suspendido && !superadmin)
    return (
      <div className="stack">
        <div>
          <button className="linklike" onClick={onBack}>
            <Icon name="back" /> Todos los condominios
          </button>
        </div>
        <PageHead icon="building" title={c.nombre} />
        <AvisoSuspendido c={c} />
      </div>
    );
  const tabs: [Tab, string][] = [
    ...(puede('condominios') ? [['general', 'Datos generales'] as [Tab, string]] : []),
    ...(puede('condominios') || puede('finanzas') ? [['cuotas', 'Cuotas y pagos'] as [Tab, string]] : []),
    ...(puede('condominios') || puede('usuarios') ? [['residentes', `Residentes (${unidades.length})`] as [Tab, string]] : []),
    ...(puede('amenidades') ? [['amenidades', 'Amenidades'] as [Tab, string]] : []),
    ...(puede('condominios') ? [['servicios', 'Servicios del portal'] as [Tab, string]] : []),
  ];
  const actual = tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0];

  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onBack}>
          <Icon name="back" /> Todos los condominios
        </button>
      </div>
      <PageHead
        icon="building"
        title={c.nombre}
        sub={`${c.tipo ?? 'Sin tipo'} · ${nombreTipoUnidad(c.tipoUnidad)} · ${unidades.length} unidades${c.activo === false ? ' · portal inactivo' : ''}`}
      />
      <Firma item={c} alta="Dado de alta por" />
      {c.suspendido && <AvisoSuspendido c={c} />}
      <Seg value={actual} onChange={setTab} options={tabs} />
      {actual === 'general' && (
        <>
          <DatosCondominio key={`g${c.id}`} c={c} seccion="general" />
          {superadmin && <AdminsCondominio key={`a${c.id}`} />}
          <Documentos />
          {superadmin && <ZonaCondominio key={`z${c.id}`} onEliminado={onBack} />}
        </>
      )}
      {actual === 'cuotas' && (
        <>
          {puede('condominios') && <DatosCondominio key={`c${c.id}`} c={c} seccion="cuotas" />}
          {puede('finanzas') && <Extraordinarias key={`e${c.id}`} />}
        </>
      )}
      {actual === 'residentes' && <Residentes key={c.id} irAGenerales={() => setTab('general')} />}
      {actual === 'amenidades' && <CatalogoAmenidades key={c.id} />}
      {actual === 'servicios' && <DatosCondominio key={`s${c.id}`} c={c} seccion="servicios" />}
    </div>
  );
}

function NuevoCondominio({ onCancel, onDone }: { onCancel: () => void; onDone: (id: string) => void }) {
  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onCancel}>
          <Icon name="back" /> Todos los condominios
        </button>
      </div>
      <PageHead
        icon="building"
        title="Nuevo condominio"
        sub="Captura los datos, la cuota y los servicios. Al guardar podrás dar de alta las casas o departamentos y sus residentes."
      />
      <DatosCondominio c={{ activo: true, modulos: MODULOS.map((m) => m.key), diaVencimiento: 10 }} seccion="todo" onCreado={onDone} />
    </div>
  );
}

type Seccion = 'general' | 'cuotas' | 'servicios' | 'todo';

/** Formulario del condominio. En la ficha se guarda por sección; al crear, todo junto. */
function DatosCondominio({ c, seccion, onCreado }: { c: Partial<Condominio>; seccion: Seccion; onCreado?: (id: string) => void }) {
  const { tiene, puede, reloadCondos } = useAdmin();
  const estructurado = !!(c.banco || c.beneficiario || c.clabe || c.cuentaBancaria || c.referenciaPago || c.notasPago);
  const [f, setF] = useState({
    nombre: c.nombre ?? '',
    tipo: c.tipo ?? TIPOS[0],
    tipoUnidad: c.tipoUnidad ?? '',
    direccion: c.direccion ?? '',
    telefonoCaseta: c.telefonoCaseta ?? '',
    estacionamientoVisitas: c.estacionamientoVisitas ? String(c.estacionamientoVisitas) : '',
    serviciosCondominio: (c.serviciosCondominio ?? []).filter(Boolean) as string[],
    cuotaMensual: c.cuotaMensual != null ? String(c.cuotaMensual) : '',
    diaVencimiento: String(c.diaVencimiento ?? 10),
    recargoActivo: !!c.recargoActivo,
    recargoMonto: c.recargoMonto != null ? String(c.recargoMonto) : '',
    avisoMorosidad: c.avisoMorosidad ?? 'NOTIFICACION',
    cuotaAutomatica: !!c.cuotaAutomatica,
    diaCargo: String(c.diaCargo ?? 1),
    banco: c.banco ?? '',
    beneficiario: c.beneficiario ?? '',
    clabe: c.clabe ?? '',
    cuentaBancaria: c.cuentaBancaria ?? '',
    referenciaPago: c.referenciaPago ?? '',
    // Condominios anteriores: el texto libre de datos de pago pasa a «Instrucciones adicionales».
    notasPago: c.notasPago ?? (estructurado ? '' : (c.datosPago ?? '')),
    activo: c.activo !== false,
    modulos: (c.modulos ?? []).filter(Boolean) as string[],
  });
  const { run, busy } = useAction();
  const ver = (s: Exclude<Seccion, 'todo'>) => seccion === 'todo' || seccion === s;
  const puedeGeneral = puede('condominios', 'editar');
  const puedePago = tiene('condominios.datosPago');
  const puedeAviso = tiene('condominios.avisoMorosidad');
  const puedeServicios = tiene('condominios.servicios');
  const editable = (seccion === 'general' && puedeGeneral) || (seccion === 'cuotas' && (puedePago || puedeAviso)) || (seccion === 'servicios' && puedeServicios) || seccion === 'todo';
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const toggle = (m: string) => setF({ ...f, modulos: f.modulos.includes(m) ? f.modulos.filter((x) => x !== m) : [...f.modulos, m] });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const general = {
      nombre: f.nombre.trim(),
      tipo: f.tipo,
      tipoUnidad: f.tipoUnidad,
      direccion: f.direccion,
      telefonoCaseta: f.telefonoCaseta,
      estacionamientoVisitas: f.estacionamientoVisitas === '' ? null : Math.max(0, Math.floor(Number(f.estacionamientoVisitas))),
      serviciosCondominio: f.serviciosCondominio,
    };
    const pago = {
      cuotaMensual: f.cuotaMensual === '' ? null : Number(f.cuotaMensual),
      diaVencimiento: Number(f.diaVencimiento) || 10,
      banco: f.banco.trim(),
      beneficiario: f.beneficiario.trim(),
      clabe: f.clabe.replace(/\s/g, ''),
      cuentaBancaria: f.cuentaBancaria.trim(),
      referenciaPago: f.referenciaPago.trim(),
      notasPago: f.notasPago.trim(),
      recargoActivo: f.recargoActivo,
      recargoMonto: f.recargoMonto === '' ? null : Number(f.recargoMonto),
      // Al activarlo, solo cuentan las cuotas que venzan desde hoy (no se cobran recargos de meses anteriores).
      recargoDesde: f.recargoActivo ? (c.recargoActivo && c.recargoDesde ? c.recargoDesde : hoy()) : null,
      // Cuota automática: al activarla, se generan los meses cuya fecha de cargo sea a partir de hoy.
      cuotaAutomatica: f.cuotaAutomatica,
      diaCargo: Math.min(Math.max(Number(f.diaCargo) || 1, 1), 28),
      cuotaAutomaticaDesde: f.cuotaAutomatica ? (c.cuotaAutomatica && c.cuotaAutomaticaDesde ? c.cuotaAutomaticaDesde : hoy()) : null,
    };
    // Aviso de pago vencido: solo cuenta para las cuotas que venzan desde la primera vez que se guarda.
    const aviso = { avisoMorosidad: f.avisoMorosidad, avisoMorosidadDesde: c.avisoMorosidadDesde ?? hoy() };
    const pagoTodo = { ...pago, datosPago: textoDatosPago(pago), ...aviso };
    const servicios = { modulos: f.modulos, activo: f.activo };
    const datos =
      seccion === 'general'
        ? general
        : seccion === 'cuotas'
          ? pagoTodo
          : seccion === 'servicios'
            ? servicios
            : { ...general, ...(puedePago ? pagoTodo : {}), ...(puedeServicios ? servicios : {}) };
    let id = c.id;
    const okk = await run(
      async () => {
        if (!f.tipoUnidad && ver('general')) throw new Error('Indica si el condominio es de casas o de departamentos.');
        if (ver('cuotas') && f.recargoActivo && !(Number(f.recargoMonto) > 0)) throw new Error('Indica el monto del recargo por pago tardío.');
        if (ver('cuotas') && f.cuotaAutomatica) {
          if (!(Number(f.cuotaMensual) > 0)) throw new Error('Para generar la cuota automáticamente, indica la cuota mensual.');
          if ((Number(f.diaCargo) || 1) > (Number(f.diaVencimiento) || 10))
            throw new Error('El día en que se genera el cargo debe ser igual o anterior al día de vencimiento.');
        }
        const r = c.id ? ok(await db.models.Condominio.update({ id: c.id, ...datos })) : ok(await db.models.Condominio.create(datos as never));
        id = r?.id ?? id;
      },
      c.id ? 'Cambios guardados' : 'Condominio creado. Ahora da de alta sus casas o departamentos y residentes.',
    );
    if (okk) {
      reloadCondos();
      if (!c.id && id) onCreado?.(id);
    }
  }

  return (
    <form className="stack" onSubmit={guardar}>
      {ver('general') && (
        <section className="panel">
          {seccion === 'todo' && <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Datos generales</h2>}
          <div className="form">
            <div className="form-2">
              <Field label="Nombre del condominio">
                <input required maxLength={120} value={f.nombre} onChange={set('nombre')} disabled={!puedeGeneral} />
              </Field>
              <Field label="Tipo de condominio">
                <select value={f.tipo} onChange={set('tipo')} disabled={!puedeGeneral}>
                  {TIPOS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Las unidades son" hint={f.tipoUnidad ? `Se identifican como «${prefijoUnidad(f.tipoUnidad)} 12», «${prefijoUnidad(f.tipoUnidad)} A-101»…` : undefined}>
                <select required value={f.tipoUnidad} onChange={set('tipoUnidad')} disabled={!puedeGeneral}>
                  <option value="">Selecciona…</option>
                  {TIPOS_UNIDAD.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Teléfono de caseta">
                <input type="tel" maxLength={20} value={f.telefonoCaseta} onChange={set('telefonoCaseta')} disabled={!puedeGeneral} />
              </Field>
              <Field
                label="Lugares de estacionamiento para visitas"
                hint="La caseta ve cuántos quedan libres: cada visita en auto ocupa uno al entrar y lo libera al salir. Déjalo vacío si no se lleva el control."
              >
                <input type="number" min="0" max="999" step="1" value={f.estacionamientoVisitas} onChange={set('estacionamientoVisitas')} disabled={!puedeGeneral} placeholder="Ej. 5" />
              </Field>
            </div>
            <Field label="Dirección">
              <textarea rows={2} maxLength={300} value={f.direccion} onChange={set('direccion')} disabled={!puedeGeneral} placeholder="Calle, número, colonia, municipio, estado, C.P." />
            </Field>
            <ServiciosCondominio valor={f.serviciosCondominio} onChange={(serviciosCondominio) => setF({ ...f, serviciosCondominio })} disabled={!puedeGeneral} />
          </div>
        </section>
      )}

      {ver('cuotas') && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Cuota de mantenimiento</h2>
          {!puedePago && <p className="small muted">Tu rol no permite cambiar la cuota ni los datos bancarios.</p>}
          <div className="form">
            <div className="form-2">
              <Field label="Cuota mensual (MXN)" hint="La misma para todas las casas o departamentos.">
                <input type="number" min="0" step="0.01" value={f.cuotaMensual} onChange={set('cuotaMensual')} disabled={!puedePago} placeholder="1500.00" />
              </Field>
              <Field label="Día de vencimiento" hint="Día del mes en que vence la cuota (1 a 28).">
                <input type="number" min="1" max="28" value={f.diaVencimiento} onChange={set('diaVencimiento')} disabled={!puedePago} />
              </Field>
            </div>
            <div className="recargo">
              <label className="check" style={{ fontWeight: 700 }}>
                <input type="checkbox" checked={f.cuotaAutomatica} disabled={!puedePago} onChange={(e) => setF({ ...f, cuotaAutomatica: e.target.checked })} />
                Generar la cuota automáticamente cada mes
              </label>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>
                Cada mes, el día que elijas, se carga la cuota de mantenimiento al estado de cuenta de cada casa o departamento (con vencimiento el día{' '}
                {Math.min(Math.max(Number(f.diaVencimiento) || 10, 1), 28)}) y cada residente recibe un aviso. Nunca se duplica: si ya la generaste a mano, no se
                vuelve a crear.
                {c.cuotaAutomatica && c.cuotaAutomaticaDesde
                  ? ` Activa desde el ${fecha(c.cuotaAutomaticaDesde)}.`
                  : ' Al activarla, empieza en la siguiente fecha de cargo (no se cobran meses anteriores).'}
              </p>
              {f.cuotaAutomatica && (
                <Field label="Día en que se genera el cargo" hint="Del 1 al 28; igual o antes del día de vencimiento.">
                  <input type="number" min="1" max="28" required value={f.diaCargo} onChange={set('diaCargo')} disabled={!puedePago} style={{ maxWidth: 120 }} />
                </Field>
              )}
            </div>
            <div className="recargo">
              <label className="check" style={{ fontWeight: 700 }}>
                <input type="checkbox" checked={f.recargoActivo} disabled={!puedePago} onChange={(e) => setF({ ...f, recargoActivo: e.target.checked })} />
                Cobrar recargo por pago tardío
              </label>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>
                Al día siguiente del vencimiento (día {Math.min(Math.max(Number(f.diaVencimiento) || 10, 1), 28) + 1}) se carga el recargo a cada residente que no
                haya pagado ni subido su comprobante. Se aplica una sola vez por cuota y se incluye en el aviso de pago vencido.
                {c.recargoActivo && c.recargoDesde ? ` Activo desde el ${fecha(c.recargoDesde)}.` : ' Al activarlo, aplica a las cuotas que venzan a partir de hoy.'}
              </p>
              {f.recargoActivo && (
                <Field label="Monto del recargo (MXN)">
                  <input type="number" min="0.01" step="0.01" required value={f.recargoMonto} onChange={set('recargoMonto')} disabled={!puedePago} placeholder="150.00" style={{ maxWidth: 220 }} />
                </Field>
              )}
            </div>
            <div className="recargo">
              <Field
                label="Aviso de pago vencido"
                hint="Al día siguiente del vencimiento, cada casa o departamento que no haya pagado ni subido su comprobante recibe un aviso con su estado de cuenta: lo que venció, sus pendientes anteriores, el total y los datos para pagar."
              >
                <select value={f.avisoMorosidad} onChange={set('avisoMorosidad')} disabled={!puedeAviso} style={{ maxWidth: 360 }}>
                  <option value="NOTIFICACION">Solo notificación (portal y app)</option>
                  <option value="CORREO">Solo correo</option>
                  <option value="AMBOS">Notificación y correo</option>
                </select>
              </Field>
              {!puedeAviso && <p className="small muted" style={{ margin: '4px 0 0' }}>Tu rol no permite cambiar cómo se avisa de los pagos vencidos.</p>}
            </div>
            <h3 style={{ fontSize: '1rem', margin: '8px 0 0' }}>¿Dónde se pagan las cuotas?</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Los residentes ven estos datos en Finanzas para hacer su transferencia o depósito.
            </p>
            <div className="form-2">
              <Field label="Banco">
                <input maxLength={60} value={f.banco} onChange={set('banco')} disabled={!puedePago} placeholder="BBVA" />
              </Field>
              <Field label="Beneficiario">
                <input maxLength={120} value={f.beneficiario} onChange={set('beneficiario')} disabled={!puedePago} placeholder="Condominio … A.C." />
              </Field>
              <Field label="CLABE interbancaria">
                <input inputMode="numeric" pattern="\d{18}" title="La CLABE tiene 18 dígitos" maxLength={22} value={f.clabe} onChange={set('clabe')} disabled={!puedePago} />
              </Field>
              <Field label="Número de cuenta">
                <input inputMode="numeric" maxLength={20} value={f.cuentaBancaria} onChange={set('cuentaBancaria')} disabled={!puedePago} />
              </Field>
            </div>
            <Field label="Referencia" hint="Qué deben escribir en el concepto de la transferencia.">
              <input maxLength={120} value={f.referenciaPago} onChange={set('referenciaPago')} disabled={!puedePago} placeholder="Número de casa o departamento" />
            </Field>
            <Field label="Instrucciones adicionales">
              <textarea maxLength={1000} value={f.notasPago} onChange={set('notasPago')} disabled={!puedePago} placeholder="Pagos en efectivo en la oficina de administración de lunes a viernes…" />
            </Field>
          </div>
        </section>
      )}

      {ver('servicios') && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Servicios del portal</h2>
          <p className="small muted">
            {puedeServicios ? 'Solo los servicios marcados aparecen en el portal de este condominio.' : 'Tu rol no permite cambiar los servicios.'}
          </p>
          <div className="checks">
            {MODULOS.map((m) => (
              <label key={m.key} className="check">
                <input type="checkbox" disabled={!puedeServicios} checked={f.modulos.includes(m.key)} onChange={() => toggle(m.key)} />
                {m.label}
              </label>
            ))}
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" disabled={!puedeServicios} checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
            Portal activo (si se desactiva, ningún residente ni vigilante de este condominio puede entrar)
          </label>
        </section>
      )}

      {editable && (
        <div>
          <button className="btn-app" disabled={busy}>
            {busy ? 'Guardando…' : c.id ? 'Guardar cambios' : 'Crear condominio'}
          </button>
        </div>
      )}
    </form>
  );
}

// ---------- Cuotas extraordinarias ----------
// Cada cuota extraordinaria es un cargo por unidad con id «extra#<grupo>#<unidad>».
function Extraordinarias() {
  const { condoId, unidades, puede } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const { data, error, loading, reload } = useLoad(() => all<Cargo>((o) => db.models.Cargo.cargosPorCondominio({ condominioId: condoId }, o)), [condoId]);
  const [nueva, setNueva] = useState(false);
  const [ficha, setFicha] = useState<string | null>(null);
  const { run, busy } = useAction();

  const grupos = Object.values(
    (data ?? [])
      .filter((x) => x.id.startsWith('extra#'))
      .reduce<Record<string, Cargo[]>>((acc, x) => ((acc[x.id.split('#')[1]] ??= []).push(x), acc), {}),
  ).sort((a, b) => String(b[0].vence).localeCompare(String(a[0].vence)));
  const fichaG = grupos.find((g) => g[0].id === ficha);

  const cancelar = (g: Cargo[]) => {
    const pendientes = g.filter((x) => x.estado === 'PENDIENTE');
    if (!confirm(`¿Cancelar «${g[0].concepto}»? Se cancelan ${pendientes.length} cargo(s) sin pagar; los ya pagados se conservan.`)) return;
    run(async () => {
      for (let i = 0; i < pendientes.length; i += 10) {
        await Promise.all(pendientes.slice(i, i + 10).map(async (x) => ok(await db.models.Cargo.update({ id: x.id, estado: 'CANCELADO' }))));
      }
      reload(true);
    }, 'Cuota extraordinaria cancelada');
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: '1.1rem' }}>Cuotas extraordinarias</h2>
        {gestiona && (
          <button type="button" className="btn-app sm" onClick={() => setNueva(true)} disabled={!unidades.length}>
            <Icon name="plus" />
            Agregar cuota extraordinaria
          </button>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Se cargan al estado de cuenta de cada residente en cuanto las agregas. Las cuotas mensuales se generan solas si activas la cuota automática en Cuotas y pagos, o en Finanzas › Generar cuotas del mes.
      </p>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : grupos.length ? (
        <Tarjetas>
          {grupos.map((g) => {
            const pagados = g.filter((x) => x.estado === 'PAGADO').length;
            const vigentes = g.filter((x) => x.estado !== 'CANCELADO').length;
            return (
              <Tarjeta
                key={g[0].id}
                tono={!vigentes ? 'neutro' : pagados === vigentes ? 'ok' : g.some((x) => x.estado === 'PENDIENTE' && x.vence && x.vence < hoy()) ? 'mal' : 'warn'}
                onClick={() => setFicha(g[0].id)}
                media={<TarjetaIcono name="money" />}
                titulo={g[0].concepto}
                sub={`${money(g[0].monto)} por unidad · vence ${fecha(g[0].vence)}`}
                lado={!vigentes ? <Badge estado="CANCELADO">Cancelada</Badge> : <Badge estado={pagados === vigentes ? 'PAGADO' : 'PENDIENTE'}>{`${pagados} de ${vigentes} pagadas`}</Badge>}
              />
            );
          })}
        </Tarjetas>
      ) : (
        <Empty icon="money">Sin cuotas extraordinarias.</Empty>
      )}
      {fichaG && (
        <Modal title={fichaG[0].concepto} onClose={() => setFicha(null)}>
          <div className="stack">
            <Datos
              items={[
                ['Monto por unidad', money(fichaG[0].monto)],
                ['Vence', fecha(fichaG[0].vence)],
                ['Unidades', String(fichaG.filter((x) => x.estado !== 'CANCELADO').length)],
                ['Pagadas', String(fichaG.filter((x) => x.estado === 'PAGADO').length)],
                ['Pendientes', String(fichaG.filter((x) => x.estado === 'PENDIENTE').length)],
              ]}
            />
            {gestiona && fichaG.some((x) => x.estado === 'PENDIENTE') && (
              <Acciones>
                <button type="button" className="btn-app danger" disabled={busy} onClick={() => (setFicha(null), cancelar(fichaG))}>
                  Cancelar cuota
                </button>
              </Acciones>
            )}
          </div>
        </Modal>
      )}
      {nueva && <NuevaExtraordinaria onClose={() => setNueva(false)} onDone={() => (setNueva(false), reload(true))} />}
    </section>
  );
}

function NuevaExtraordinaria({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condoId, unidades } = useAdmin();
  const [f, setF] = useState({ concepto: '', monto: '', vence: hoy(), todas: true, tipo: 'RECAUDACION' });
  const [elegidas, setElegidas] = useState<string[]>([]);
  const { run, busy } = useAction();
  const n = f.todas ? unidades.length : elegidas.length;
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      if (!n) throw new Error('Elige al menos una unidad.');
      await adminCall('cargoExtraordinario', {
        condominioId: condoId,
        concepto: f.concepto,
        monto: Number(f.monto),
        vence: f.vence,
        tipo: f.tipo,
        ...(f.todas ? {} : { unidadIds: elegidas }),
      });
    }, `Cuota extraordinaria cargada a ${n} unidad(es)`);
    if (okk) onDone();
  }
  return (
    <Modal title="Cuota extraordinaria" onClose={onClose}>
      <form className="form" onSubmit={crear}>
        <Field label="Concepto">
          <input required maxLength={120} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Impermeabilización 2026" />
        </Field>
        <TipoIngreso value={f.tipo} onChange={(tipo) => setF({ ...f, tipo })} />
        <div className="form-2">
          <Field label="Monto por unidad (MXN)">
            <input required type="number" min="0.01" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} />
          </Field>
          <Field label="Fecha límite de pago">
            <input required type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
          </Field>
        </div>
        <Seg
          value={f.todas ? 'todas' : 'algunas'}
          onChange={(v) => setF({ ...f, todas: v === 'todas' })}
          options={[
            ['todas', `Todas las unidades (${unidades.length})`],
            ['algunas', 'Solo algunas'],
          ]}
        />
        {!f.todas && (
          <div className="checks" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {unidades.map((u) => (
              <label key={u.id} className="check">
                <input
                  type="checkbox"
                  checked={elegidas.includes(u.id)}
                  onChange={() => setElegidas(elegidas.includes(u.id) ? elegidas.filter((x) => x !== u.id) : [...elegidas, u.id])}
                />
                {u.etiqueta}
              </label>
            ))}
          </div>
        )}
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : `Cargar a ${n} unidad(es)`}
        </button>
      </form>
    </Modal>
  );
}

/** Servicios del condominio: se agregan de la lista (o uno propio) y se quitan con la ×. */
function ServiciosCondominio({ valor, onChange, disabled }: { valor: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [elegido, setElegido] = useState('');
  const [otro, setOtro] = useState('');
  const disponibles = SERVICIOS_SUGERIDOS.filter((x) => !valor.includes(x));
  const agregar = () => {
    const nuevo = (elegido === '__otro' ? otro : elegido).trim();
    if (!nuevo || valor.some((x) => x.toLowerCase() === nuevo.toLowerCase())) return;
    onChange([...valor, nuevo]);
    setElegido('');
    setOtro('');
  };
  return (
    <Field label="Servicios del condominio" hint="La caseta avisa a todos los residentes cuando entra uno de estos servicios (botón «Aviso de servicios»).">
      <div className="servicios-chips">
        {valor.length ? (
          valor.map((x) => (
            <span key={x} className="acceso-chip">
              {x}
              {!disabled && (
                <button type="button" className="chip-x" aria-label={`Quitar ${x}`} onClick={() => onChange(valor.filter((y) => y !== x))}>
                  ×
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="small muted">Sin servicios configurados.</span>
        )}
      </div>
      {!disabled && (
        <div className="servicios-agregar">
          <select value={elegido} onChange={(e) => setElegido(e.target.value)}>
            <option value="">Agregar servicio…</option>
            {disponibles.map((x) => (
              <option key={x}>{x}</option>
            ))}
            <option value="__otro">Otro…</option>
          </select>
          {elegido === '__otro' && <input maxLength={40} value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Ej. Fumigación" />}
          <button type="button" className="btn-app sm secondary" disabled={!elegido || (elegido === '__otro' && !otro.trim())} onClick={agregar}>
            <Icon name="plus" />
            Agregar
          </button>
        </div>
      )}
    </Field>
  );
}

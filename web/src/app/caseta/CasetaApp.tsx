// Modo caseta (rol VIGILANTE): validar pases QR, registrar entradas/salidas, llegadas sin pase,
// alertas a residentes y chat con las unidades.
import QrScanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'react';
import { portal, subirArchivo } from '../api';
import { ChatBox, type Msg } from '../ChatBox';
import { Shell, useHashNav, type NavItem } from '../Shell';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, etiquetaEstado, fecha, fechaHora, useAction, useLoad, usePoll } from '../ui';
import type { PerfilResp } from '../portal/PortalApp';
import type { Visita } from '../portal/Visitas';
import { useInsigniaApp } from '../AppMovil';
import { comprimirImagen, mensajeErrorCamara, pedirCamara } from '../camara';
import { RegistroVigilancia } from './Vigilancia';
import { Campana, marcarVisto, useVistos, type ItemCampana } from '../Campana';

const VISTOS_CASETA = 'siia-vistos-caseta';

type V = Visita & { unidad: string; estacionamiento?: Estacionamiento };

/** Lugares de estacionamiento de visitas libres (siempre visible en la caseta si el condominio lo configuró). */
function Lugares({ e }: { e?: Estacionamiento }) {
  if (!e?.total) return null;
  const clase = !e.libres ? 'mal' : e.libres <= Math.max(1, Math.round(e.total * 0.2)) ? 'warn' : 'ok';
  return (
    <div className={`lugares ${clase}`} role="status" aria-live="polite" title="Estacionamiento de visitas">
      <span className="lugares-p">P</span>
      <span>
        <strong>{e.libres}</strong> de {e.total} lugares libres
      </span>
      <Icon name="car" />
    </div>
  );
}
type Hilo = { unidadId: string; unidad: string; ultimo: Msg };
type Estacionamiento = { total: number; ocupados: number; libres: number };
type Panel = {
  hoy: string;
  estacionamiento?: Estacionamiento;
  solicitudes?: V[];
  dentro: V[];
  esperadas: V[];
  bitacora: V[];
  unidades: { id: string; etiqueta: string }[];
  extraviadas: { id: string; nombre: string; especie?: string; raza?: string; color?: string; unidad: string; fotoUrl?: string }[];
};

export default function CasetaApp({ perfil }: { perfil: PerfilResp }) {
  const mods = perfil.condominio!.modulos ?? [];
  const [cur, go] = useHashNav('escanear');
  const panel = useLoad(() => portal<Panel>('caseta.panel'), []);
  // Con solicitudes de acceso esperando respuesta del residente se actualiza más seguido
  const esperando = (panel.data?.solicitudes ?? []).some((v) => v.estado === 'POR_AUTORIZAR');
  usePoll(() => panel.reload(true), esperando ? 6000 : 30000, mods.includes('visitas'));
  const porAtender = (panel.data?.solicitudes ?? []).filter((v) => v.estado === 'AUTORIZADA').length;
  // Conversaciones cuyo último mensaje es de un residente (menú Chat)
  const conChat = mods.includes('visitas') && mods.includes('chat');
  const hilos = useLoad(() => (conChat ? portal<Hilo[]>('caseta.hilos') : Promise.resolve([] as Hilo[])), [conChat]);
  usePoll(() => hilos.reload(true), 15000, conChat);
  const porResponder = (hilos.data ?? []).filter((h) => h.ultimo.autorRol === 'RESIDENTE').length;
  const vistos = useVistos(VISTOS_CASETA);

  const nav: NavItem[] = [
    { key: 'escanear', label: 'Escanear pase', icon: 'qr', count: porAtender },
    { key: 'hoy', label: 'Hoy', icon: 'calendar', count: panel.data?.dentro.length },
    { key: 'llegada', label: 'Registrar llegada', icon: 'package' },
    { key: 'vigilancia', label: 'Registro de vigilancia', icon: 'shield' },
    ...(mods.includes('chat') ? [{ key: 'chat', label: 'Chat', icon: 'chat', count: porResponder }] : []),
  ];
  // «chat/<unidad>» abre esa conversación (campana o notificación push)
  const [base, sub] = cur.split('/');
  const actual = nav.some((n) => n.key === base) ? base : 'escanear';

  // Campana: respuestas de residentes a llegadas sin pase y chats por responder; cada renglón lleva a donde se atiende.
  const avisos: ItemCampana[] = vistos([
    ...(panel.data?.solicitudes ?? [])
      .filter((v) => v.estado === 'AUTORIZADA' || v.estado === 'RECHAZADA')
      .map((v) => ({
        id: `sol-${v.id}-${v.estado}`,
        icono: 'shield',
        titulo: `${v.estado === 'AUTORIZADA' ? 'Autorizado' : 'Rechazado'}: ${v.nombre}`,
        texto: `${v.unidad} · ${v.estado === 'AUTORIZADA' ? 'registra la entrada' : 'no autorizó el acceso'}`,
        nuevo: true,
        abrir: () => go('escanear'),
      })),
    ...(panel.data?.solicitudes ?? [])
      .filter((v) => v.estado === 'POR_AUTORIZAR')
      .map((v) => ({ id: `sol-${v.id}`, icono: 'shield', titulo: `Esperando respuesta: ${v.nombre}`, texto: v.unidad, abrir: () => go('escanear') })),
    ...(hilos.data ?? [])
      .filter((h) => h.ultimo.autorRol === 'RESIDENTE')
      .map((h) => ({
        id: `chat-${h.unidadId}`,
        icono: 'chat',
        titulo: `Mensaje de ${h.unidad}`,
        texto: h.ultimo.texto || '📷 Foto',
        fecha: h.ultimo.createdAt,
        nuevo: true,
        abrir: () => go(`chat/${h.unidadId}`),
      })),
  ]);
  const sinRevisar = avisos.filter((a) => a.nuevo).length;
  // El icono de la app lleva el mismo número que la campana
  useInsigniaApp(sinRevisar);

  if (!mods.includes('visitas'))
    return (
      <div className="auth-screen">
        <div className="panel auth-card">La administración aún no habilita el módulo de visitas y caseta para este condominio.</div>
      </div>
    );


  return (
    <Shell api="portal" nav={nav} current={actual} onNav={go} title={`Caseta · ${perfil.condominio!.nombre}`} subtitle={perfil.perfil?.nombre ?? perfil.email} user={perfil.email} actions={<Campana total={sinRevisar} items={avisos} vacio="Sin pendientes." />}>
      {panel.error && <ErrorBox error={panel.error} retry={panel.reload} />}
      {!!panel.data?.extraviadas.length && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          <strong>Mascotas extraviadas:</strong>{' '}
          {panel.data.extraviadas.map((m) => `${m.nombre} (${[m.especie, m.color].filter(Boolean).join(', ')} · ${m.unidad})`).join(' · ')}
        </div>
      )}
      <div className="caseta-barra">
        <Lugares e={panel.data?.estacionamiento} />
        {!!perfil.condominio!.serviciosCondominio?.length && <AvisoServicios servicios={perfil.condominio!.serviciosCondominio!} />}
      </div>
      {actual === 'escanear' && (
        <>
          <Solicitudes lista={panel.data?.solicitudes ?? []} est={panel.data?.estacionamiento} onCambio={() => panel.reload(true)} />
          <Escanear onCambio={() => panel.reload(true)} />
        </>
      )}
      {actual === 'hoy' && (panel.data ? <Hoy panel={panel.data} onCambio={() => panel.reload(true)} /> : <Loading />)}
      {actual === 'llegada' &&
        (panel.data ? (
          <>
            <Llegada unidades={panel.data.unidades} onCambio={() => panel.reload(true)} />
            <Solicitudes lista={panel.data.solicitudes ?? []} est={panel.data.estacionamiento} onCambio={() => panel.reload(true)} />
          </>
        ) : (
          <Loading />
        ))}
      {actual === 'vigilancia' && <RegistroVigilancia miNombre={perfil.perfil?.nombre ?? ''} />}
      {actual === 'chat' && <ChatCaseta key={cur} inicial={sub} unidades={panel.data?.unidades ?? []} hilos={hilos} />}
    </Shell>
  );
}

function Escanear({ onCambio }: { onCambio: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const [camara, setCamara] = useState(false);
  const [errorCamara, setErrorCamara] = useState('');
  const foto = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState('');
  const [visita, setVisita] = useState<V | null>(null);
  const { run, busy } = useAction();

  const validar = (c: string) =>
    run(async () => {
      setVisita(null);
      setVisita(await portal<V>('caseta.validar', { codigo: c }));
    });

  const leido = (data: string) => {
    setCodigo(data.replace(/^SIIA:/, ''));
    validar(data);
  };

  // Primero se pide la cámara (así el teléfono muestra su aviso de permiso) y luego arranca el escáner.
  // Si algo falla se explica el motivo y cómo resolverlo, en lugar de cerrar la cámara sin decir nada.
  const abrirCamara = async () => {
    setErrorCamara('');
    try {
      await pedirCamara();
      setCamara(true);
    } catch (e) {
      setErrorCamara(mensajeErrorCamara(e));
    }
  };

  useEffect(() => {
    if (!camara || !video.current) return;
    const s = new QrScanner(
      video.current,
      (r) => {
        s.stop();
        setCamara(false);
        leido(r.data);
      },
      { preferredCamera: 'environment', highlightScanRegion: true, returnDetailedScanResult: true, maxScansPerSecond: 8 },
    );
    scanner.current = s;
    s.start().catch((e) => {
      setCamara(false);
      setErrorCamara(mensajeErrorCamara(e));
    });
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camara]);

  // Respaldo: tomar una foto del QR con la cámara del teléfono y leerla.
  const desdeFoto = (f?: File) =>
    f &&
    run(async () => {
      setErrorCamara('');
      try {
        const r = await QrScanner.scanImage(await comprimirImagen(f, 1400), { returnDetailedScanResult: true });
        leido(r.data);
      } catch {
        throw new Error('No encontramos un código QR en la foto. Acércate al código, que se vea completo y con buena luz.');
      }
    });

  const entrada = (sinLugar = false) =>
    run(async () => {
      const r = await portal<V>('caseta.entrada', { visitaId: visita!.id, sinLugar });
      setVisita(null);
      setCodigo('');
      onCambio();
      return r;
    }, visita?.enAuto && !sinLugar && visita.estacionamiento?.total ? 'Entrada registrada: ocupa un lugar de estacionamiento.' : 'Entrada registrada; se avisó al residente.');
  // Al volver a escanear el QR de quien está dentro: salida (y se libera su lugar)
  const salida = () =>
    run(async () => {
      await portal('caseta.salida', { visitaId: visita!.id });
      setVisita(null);
      setCodigo('');
      onCambio();
    }, visita?.ocupaLugar ? 'Salida registrada: se liberó un lugar de estacionamiento.' : 'Salida registrada.');
  const est = visita?.estacionamiento;
  const sinLugares = !!(visita?.enAuto && est?.total && est.libres === 0);

  return (
    <div className="stack">
      <PageHead icon="qr" title="Validar pase" sub="Escanea el código QR del visitante o escribe el código de 8 caracteres." />
      <section className="panel scanner">
        {camara ? (
          <>
            <video ref={video} muted playsInline />
            <button className="btn-app secondary" style={{ marginTop: 10 }} onClick={() => setCamara(false)}>
              Detener cámara
            </button>
          </>
        ) : (
          <>
            <button className="btn-app block" onClick={abrirCamara}>
              <Icon name="camera" />
              Escanear con la cámara
            </button>
            <button className="btn-app block secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => foto.current?.click()}>
              <Icon name="qr" />
              Tomar foto del código
            </button>
            <input ref={foto} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (desdeFoto(e.target.files?.[0]), (e.target.value = ''))} />
          </>
        )}
        {errorCamara && (
          <div className="alert error small" style={{ marginTop: 10 }}>
            {errorCamara}
          </div>
        )}
        <form
          className="chat-form"
          style={{ marginTop: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            validar(codigo);
          }}
        >
          <input
            className="input"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="Código del pase"
            aria-label="Código del pase"
            maxLength={20}
            style={{ letterSpacing: '0.15em' }}
          />
          <button className="btn-app" disabled={busy || !codigo.trim()}>
            Validar
          </button>
        </form>
      </section>

      {visita && (
        <section className="panel" style={{ borderColor: visita.vigente ? 'var(--mint)' : '#f4d2cf' }}>
          <div className="panel-head">
            <h2>{visita.nombre}</h2>
            {visita.vigente ? <Badge estado="APROBADO">Pase válido</Badge> : <Badge estado="RECHAZADO">{visita.estado === 'DENTRO' ? 'Ya está dentro' : 'No vigente'}</Badge>}
          </div>
          <p style={{ margin: '0 0 6px' }}>
            Destino: <strong>{visita.unidad}</strong> · {etiquetaEstado(visita.tipo)}
            {visita.placas && ` · Placas ${visita.placas}`}
          </p>
          {visita.enAuto && !!est?.total && visita.estado !== 'DENTRO' && (
            <div className={`alert small ${sinLugares ? 'error' : ''}`}>
              <Icon name="car" /> Llega en auto.{' '}
              {sinLugares ? 'No hay lugares de estacionamiento de visitas libres.' : `Ocupará un lugar: quedarán ${est.libres - 1} de ${est.total}.`}
            </div>
          )}
          <p className="small muted">
            Vigencia: {fecha(visita.fecha)}
            {visita.fechaFin && ` al ${fecha(visita.fechaFin)}`} · Estado: {etiquetaEstado(visita.estado)}
          </p>
          {visita.notas && <div className="alert small">{visita.notas}</div>}
          {visita.estado === 'DENTRO' ? (
            <button className="btn-app" style={{ marginTop: 12 }} disabled={busy} onClick={salida}>
              <Icon name="logout" />
              Registrar salida{visita.ocupaLugar ? ' y liberar lugar' : ''}
            </button>
          ) : (
            visita.vigente &&
            (sinLugares ? (
              <button className="btn-app secondary" style={{ marginTop: 12 }} disabled={busy} onClick={() => entrada(true)}>
                Registrar entrada sin lugar de estacionamiento
              </button>
            ) : (
              <button className="btn-app" style={{ marginTop: 12 }} disabled={busy} onClick={() => entrada()}>
                <Icon name="check" />
                Registrar entrada
              </button>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function Hoy({ panel, onCambio }: { panel: Panel; onCambio: () => void }) {
  const { run, busy } = useAction();
  const salida = (v: V) => run(() => portal('caseta.salida', { visitaId: v.id }).then(onCambio), `Salida de ${v.nombre} registrada`);
  const entrada = (v: V) => run(() => portal('caseta.entrada', { visitaId: v.id }).then(onCambio), `Entrada de ${v.nombre} registrada`);
  const fila = (v: V, accion?: React.ReactNode) => (
    <li key={v.id}>
      <div className="list-main">
        <strong>{v.nombre}</strong> <Badge estado={v.estado} />
        <div className="list-sub">
          {v.unidad} · {etiquetaEstado(v.tipo)} {v.ocupaLugar ? '· 🚗 ocupa lugar' : v.enAuto ? '· en auto' : ''} {v.placas && `· ${v.placas}`}{' '}
          {v.entradaEn && `· Entrada ${fechaHora(v.entradaEn)}`}{' '}
          {v.salidaEn && `· Salida ${fechaHora(v.salidaEn)}`}
        </div>
      </div>
      {accion}
    </li>
  );
  return (
    <div className="stack">
      <PageHead icon="calendar" title="Movimientos de hoy" sub={fecha(panel.hoy, { weekday: 'long', day: 'numeric', month: 'long' })}>
        <button className="btn-app secondary" onClick={onCambio}>
          <Icon name="refresh" />
          Actualizar
        </button>
      </PageHead>
      <section className="panel">
        <h2>Dentro del condominio ({panel.dentro.length})</h2>
        {panel.dentro.length ? (
          <ul className="list">
            {panel.dentro.map((v) =>
              fila(
                v,
                <button className="btn-app sm secondary" disabled={busy} onClick={() => salida(v)}>
                  Registrar salida
                </button>,
              ),
            )}
          </ul>
        ) : (
          <Empty icon="shield">Nadie registrado dentro.</Empty>
        )}
      </section>
      <section className="panel">
        <h2>Esperadas hoy ({panel.esperadas.length})</h2>
        {panel.esperadas.length ? (
          <ul className="list">
            {panel.esperadas.map((v) =>
              fila(
                v,
                <button className="btn-app sm" disabled={busy} onClick={() => entrada(v)}>
                  Registrar entrada
                </button>,
              ),
            )}
          </ul>
        ) : (
          <Empty icon="qr">Sin pases programados para hoy.</Empty>
        )}
      </section>
      <section className="panel">
        <h2>Bitácora del día</h2>
        {panel.bitacora.length ? <ul className="list">{panel.bitacora.map((v) => fila(v))}</ul> : <Empty icon="file">Sin movimientos.</Empty>}
      </section>
    </div>
  );
}

function Llegada({ unidades, onCambio }: { unidades: Panel['unidades']; onCambio: () => void }) {
  const [modo, setModo] = useState<'llegada' | 'alerta'>('llegada');
  const [f, setF] = useState({ unidadId: '', tipo: 'VISITA', nombre: '', placas: '', notas: '', titulo: '', texto: '' });
  const [enAuto, setEnAuto] = useState(false);
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const paqueteria = f.tipo === 'PAQUETERIA';

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk =
      modo === 'llegada'
        ? await run(
            () => portal('caseta.registrar', { ...f, enAuto: !paqueteria && enAuto, placas: !paqueteria && enAuto ? f.placas : '' }),
            paqueteria ? 'Paquetería registrada; se avisó al residente.' : 'Solicitud enviada al residente. Espera su respuesta en «Solicitudes de acceso».',
          )
        : await run(() => portal('caseta.alertar', { unidadId: f.unidadId, titulo: f.titulo, texto: f.texto }), 'Alerta enviada');
    if (okk) {
      setF({ ...f, nombre: '', placas: '', notas: '', titulo: '', texto: '' });
      setEnAuto(false);
      onCambio();
    }
  }

  return (
    <div className="stack">
      <PageHead
        icon="package"
        title="Registrar llegada"
        sub="Sin pase QR: a una visita, servicio o proveedor se le pide permiso al residente; la paquetería solo se avisa."
      />
      <div className="seg" role="group">
        <button type="button" aria-pressed={modo === 'llegada'} onClick={() => setModo('llegada')}>
          Llegada
        </button>
        <button type="button" aria-pressed={modo === 'alerta'} onClick={() => setModo('alerta')}>
          Alerta a residente
        </button>
      </div>
      <form className="panel form" onSubmit={enviar}>
        <Field label="Unidad">
          <select required value={f.unidadId} onChange={set('unidadId')}>
            <option value="">Selecciona…</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.etiqueta}
              </option>
            ))}
          </select>
        </Field>
        {modo === 'llegada' ? (
          <>
            <Field label="Tipo">
              <select value={f.tipo} onChange={set('tipo')}>
                <option value="VISITA">Visita sin pase</option>
                <option value="SERVICIO">Servicio</option>
                <option value="PROVEEDOR">Proveedor</option>
                <option value="PAQUETERIA">Paquetería</option>
              </select>
            </Field>
            <Field label={paqueteria ? 'Paquetería / remitente' : 'Nombre completo'}>
              <input required maxLength={120} value={f.nombre} onChange={set('nombre')} />
            </Field>
            {!paqueteria && (
              <>
                <label className="check">
                  <input type="checkbox" checked={enAuto} onChange={(e) => setEnAuto(e.target.checked)} />
                  Llega en auto
                </label>
                {enAuto && (
                  <Field label="Placas">
                    <input required maxLength={20} value={f.placas} onChange={set('placas')} style={{ textTransform: 'uppercase' }} />
                  </Field>
                )}
              </>
            )}
            <Field label={paqueteria ? 'Notas (opcional)' : 'Motivo o notas (opcional)'}>
              <textarea maxLength={500} value={f.notas} onChange={set('notas')} placeholder={paqueteria ? '' : 'Ej. Entrega de muebles, viene de parte de…'} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Aviso">
              <input required maxLength={140} value={f.titulo} onChange={set('titulo')} placeholder="Ej. Su auto tiene las luces encendidas" />
            </Field>
            <Field label="Detalle (opcional)">
              <textarea maxLength={1000} value={f.texto} onChange={set('texto')} />
            </Field>
          </>
        )}
        <button className="btn-app" disabled={busy}>
          <Icon name="bell" />
          {modo === 'alerta' ? 'Enviar alerta' : paqueteria ? 'Registrar y avisar' : 'Pedir autorización al residente'}
        </button>
      </form>
    </div>
  );
}

/** Llegadas sin pase del día: esperando al residente, autorizadas (registrar entrada) o rechazadas. */
function Solicitudes({ lista, est, onCambio }: { lista: V[]; est?: Estacionamiento; onCambio: () => void }) {
  const { run, busy } = useAction();
  if (!lista.length) return null;
  const sinLugares = (v: V) => !!(v.enAuto && est?.total && est.libres === 0);
  const entrada = (v: V, sinLugar = false) =>
    run(() => portal('caseta.entrada', { visitaId: v.id, sinLugar }).then(onCambio), `Entrada de ${v.nombre} registrada; se avisó al residente.`);
  const llamada = (v: V) => {
    const nota = prompt(`¿Con quién de ${v.unidad} hablaste por teléfono para autorizar a ${v.nombre}?`);
    if (nota) run(() => portal('caseta.solicitud', { visitaId: v.id, accion: 'LLAMADA', nota }).then(onCambio), 'Acceso autorizado por llamada');
  };
  const cancelar = (v: V) =>
    confirm(`¿Cancelar la solicitud de ${v.nombre}?`) && run(() => portal('caseta.solicitud', { visitaId: v.id, accion: 'CANCELAR' }).then(onCambio), 'Solicitud cancelada');
  return (
    <section className="panel">
      <h2>Solicitudes de acceso</h2>
      <ul className="list">
        {lista.map((v) => (
          <li key={v.id} className={`solicitud ${v.estado.toLowerCase()}`}>
            <div className="list-main">
              <strong>{v.nombre}</strong>{' '}
              {v.estado === 'POR_AUTORIZAR' ? (
                <span className="pill warn">
                  <span className="pill-punto parpadea" />
                  Esperando al residente
                </span>
              ) : v.estado === 'AUTORIZADA' ? (
                <span className="pill ok">Autorizada{v.respuestaVia === 'LLAMADA' ? ' por llamada' : ''}</span>
              ) : (
                <span className="pill mal">Rechazada</span>
              )}
              <div className="list-sub">
                {v.unidad} · {etiquetaEstado(v.tipo)} {v.enAuto ? `· 🚗 ${v.placas ?? ''}` : '· a pie'} · pidió {fechaHora(v.solicitadoEn ?? v.createdAt)}
              </div>
              {v.respuestaPor && v.estado !== 'POR_AUTORIZAR' && (
                <div className="small muted">
                  {v.estado === 'RECHAZADA' ? 'Rechazó' : 'Autorizó'}: {v.respuestaPor}
                  {v.respuestaNota && ` · «${v.respuestaNota}»`}
                </div>
              )}
              {v.estado === 'AUTORIZADA' && sinLugares(v) && <div className="small" style={{ color: 'var(--danger)' }}>No hay lugares de estacionamiento de visitas libres.</div>}
            </div>
            <div className="row-actions">
              {v.estado === 'POR_AUTORIZAR' && (
                <>
                  <button className="btn-app sm secondary" disabled={busy} onClick={() => llamada(v)}>
                    <Icon name="phone" />
                    Autorizado por llamada
                  </button>
                  <button className="btn-app sm danger" disabled={busy} onClick={() => cancelar(v)}>
                    Cancelar
                  </button>
                </>
              )}
              {v.estado === 'AUTORIZADA' &&
                (sinLugares(v) ? (
                  <button className="btn-app sm secondary" disabled={busy} onClick={() => entrada(v, true)}>
                    Entrada sin lugar de estacionamiento
                  </button>
                ) : (
                  <button className="btn-app sm" disabled={busy} onClick={() => entrada(v)}>
                    <Icon name="check" />
                    Registrar entrada
                  </button>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChatCaseta({ unidades, hilos, inicial }: { unidades: Panel['unidades']; hilos: { data?: Hilo[]; reload: (silencioso?: boolean) => void }; inicial?: string }) {
  const [unidadId, setUnidadId] = useState(inicial ?? '');
  // Abrir la conversación la marca como revisada en la campana
  useEffect(() => {
    if (unidadId) marcarVisto(VISTOS_CASETA, `chat-${unidadId}`);
  }, [unidadId, hilos.data]);
  return (
    <div className="stack">
      <PageHead icon="chat" title="Chat con residentes" />
      <div className="grid-2">
        <section className="panel">
          <Field label="Conversación con">
            <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
              <option value="">Selecciona una unidad…</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.etiqueta}
                </option>
              ))}
            </select>
          </Field>
          <h3 style={{ marginTop: 16 }}>Recientes</h3>
          {hilos.data?.length ? (
            <ul className="list">
              {hilos.data.map((h) => (
                <li key={h.unidadId} style={{ cursor: 'pointer' }} onClick={() => setUnidadId(h.unidadId)}>
                  <div className="list-main">
                    <strong>{h.unidad}</strong> {h.ultimo.autorRol === 'RESIDENTE' && <Badge estado="PENDIENTE">Por responder</Badge>}
                    <div className="list-sub">
                      {h.ultimo.texto.slice(0, 60)} · {fechaHora(h.ultimo.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="chat">Sin conversaciones.</Empty>
          )}
        </section>
        <section className="panel">
          {unidadId ? (
            <ChatBox
              key={unidadId}
              deps={[unidadId]}
              miRol="VIGILANTE"
              cargar={() => portal<Msg[]>('caseta.mensajes', { unidadId })}
              enviar={async (texto, imagen) => {
                await portal('caseta.enviar', { unidadId, texto, imagenPath: imagen ? await subirArchivo(imagen, 'chat') : undefined });
                hilos.reload(true);
              }}
            />
          ) : (
            <Empty icon="chat">Selecciona una unidad para conversar.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

/** Botón azul: avisa a todos los residentes que acaba de entrar un servicio del condominio. */
function AvisoServicios({ servicios }: { servicios: string[] }) {
  const [abierto, setAbierto] = useState(false);
  const [servicio, setServicio] = useState('');
  const [nota, setNota] = useState('');
  const { run, busy } = useAction();
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`¿Avisar a todos los residentes que acaba de entrar el servicio de ${servicio.toLowerCase()}?`)) return;
    const okk = await run(async () => {
      const r = await portal<{ enviados: number }>('caseta.servicio', { servicio, nota });
      return r;
    }, `Aviso enviado a todo el condominio: ${servicio}`);
    if (okk) {
      setAbierto(false);
      setServicio('');
      setNota('');
    }
  }
  return (
    <>
      <button type="button" className="btn-app btn-azul" onClick={() => setAbierto(true)}>
        <Icon name="megaphone" />
        Aviso de servicios
      </button>
      {abierto && (
        <Modal title="Aviso de servicios" onClose={() => setAbierto(false)}>
          <form className="form" onSubmit={enviar}>
            <p className="small muted" style={{ margin: 0 }}>
              Todos los residentes reciben la notificación de que el servicio acaba de entrar al condominio.
            </p>
            <Field label="Servicio que entra">
              <select required value={servicio} onChange={(e) => setServicio(e.target.value)}>
                <option value="">Selecciona…</option>
                {servicios.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Nota (opcional)">
              <input maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Saquen su basura en los próximos 15 minutos" />
            </Field>
            <button className="btn-app btn-azul" disabled={busy || !servicio}>
              <Icon name="megaphone" />
              {busy ? 'Enviando…' : 'Enviar'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

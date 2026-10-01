// Modo caseta (rol VIGILANTE): validar pases QR, registrar entradas/salidas, llegadas sin pase,
// alertas a residentes y chat con las unidades.
import QrScanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'react';
import { portal } from '../api';
import { ChatBox, type Msg } from '../ChatBox';
import { Shell, useHashNav, type NavItem } from '../Shell';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, PageHead, etiquetaEstado, fecha, fechaHora, useAction, useLoad, usePoll } from '../ui';
import type { PerfilResp } from '../portal/PortalApp';
import type { Visita } from '../portal/Visitas';

type V = Visita & { unidad: string };
type Panel = {
  hoy: string;
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
  usePoll(() => panel.reload(true), 30000, mods.includes('visitas'));

  if (!mods.includes('visitas'))
    return (
      <div className="auth-screen">
        <div className="panel auth-card">La administración aún no habilita el módulo de visitas y caseta para este condominio.</div>
      </div>
    );

  const nav: NavItem[] = [
    { key: 'escanear', label: 'Escanear pase', icon: 'qr' },
    { key: 'hoy', label: 'Hoy', icon: 'calendar', count: panel.data?.dentro.length },
    { key: 'llegada', label: 'Registrar llegada', icon: 'package' },
    ...(mods.includes('chat') ? [{ key: 'chat', label: 'Chat', icon: 'chat' }] : []),
  ];
  const actual = nav.some((n) => n.key === cur) ? cur : 'escanear';

  return (
    <Shell nav={nav} current={actual} onNav={go} title={`Caseta · ${perfil.condominio!.nombre}`} subtitle={perfil.perfil?.nombre ?? perfil.email} user={perfil.email}>
      {panel.error && <ErrorBox error={panel.error} retry={panel.reload} />}
      {!!panel.data?.extraviadas.length && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          <strong>Mascotas extraviadas:</strong>{' '}
          {panel.data.extraviadas.map((m) => `${m.nombre} (${[m.especie, m.color].filter(Boolean).join(', ')} · ${m.unidad})`).join(' · ')}
        </div>
      )}
      {actual === 'escanear' && <Escanear onCambio={() => panel.reload(true)} />}
      {actual === 'hoy' && (panel.data ? <Hoy panel={panel.data} onCambio={() => panel.reload(true)} /> : <Loading />)}
      {actual === 'llegada' && (panel.data ? <Llegada unidades={panel.data.unidades} onCambio={() => panel.reload(true)} /> : <Loading />)}
      {actual === 'chat' && <ChatCaseta unidades={panel.data?.unidades ?? []} />}
    </Shell>
  );
}

function Escanear({ onCambio }: { onCambio: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const [camara, setCamara] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [visita, setVisita] = useState<V | null>(null);
  const { run, busy } = useAction();

  const validar = (c: string) =>
    run(async () => {
      setVisita(null);
      setVisita(await portal<V>('caseta.validar', { codigo: c }));
    });

  useEffect(() => {
    if (!camara || !video.current) return;
    const s = new QrScanner(
      video.current,
      (r) => {
        s.stop();
        setCamara(false);
        setCodigo(r.data.replace(/^SIIA:/, ''));
        validar(r.data);
      },
      { preferredCamera: 'environment', highlightScanRegion: true, returnDetailedScanResult: true },
    );
    scanner.current = s;
    s.start().catch(() => setCamara(false));
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camara]);

  const entrada = () =>
    run(async () => {
      await portal('caseta.entrada', { visitaId: visita!.id });
      setVisita(null);
      setCodigo('');
      onCambio();
    }, 'Entrada registrada; se avisó al residente.');

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
          <button className="btn-app block" onClick={() => setCamara(true)}>
            <Icon name="camera" />
            Escanear con la cámara
          </button>
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
          <p className="small muted">
            Vigencia: {fecha(visita.fecha)}
            {visita.fechaFin && ` al ${fecha(visita.fechaFin)}`} · Estado: {etiquetaEstado(visita.estado)}
          </p>
          {visita.notas && <div className="alert small">{visita.notas}</div>}
          {visita.vigente && (
            <button className="btn-app" style={{ marginTop: 12 }} disabled={busy} onClick={entrada}>
              <Icon name="check" />
              Registrar entrada
            </button>
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
          {v.unidad} · {etiquetaEstado(v.tipo)} {v.placas && `· ${v.placas}`} {v.entradaEn && `· Entrada ${fechaHora(v.entradaEn)}`}{' '}
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
  const [f, setF] = useState({ unidadId: '', tipo: 'PAQUETERIA', nombre: '', placas: '', notas: '', titulo: '', texto: '' });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk =
      modo === 'llegada'
        ? await run(() => portal('caseta.registrar', f), 'Registrado; se alertó al residente.')
        : await run(() => portal('caseta.alertar', { unidadId: f.unidadId, titulo: f.titulo, texto: f.texto }), 'Alerta enviada');
    if (okk) {
      setF({ ...f, nombre: '', placas: '', notas: '', titulo: '', texto: '' });
      onCambio();
    }
  }

  return (
    <div className="stack">
      <PageHead icon="package" title="Registrar llegada" sub="Visitas sin pase, servicios o paquetería. El residente recibe una alerta en su portal." />
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
            <div className="form-2">
              <Field label="Tipo">
                <select value={f.tipo} onChange={set('tipo')}>
                  <option value="PAQUETERIA">Paquetería</option>
                  <option value="VISITA">Visita sin pase</option>
                  <option value="SERVICIO">Servicio</option>
                  <option value="PROVEEDOR">Proveedor</option>
                </select>
              </Field>
              <Field label="Placas (opcional)">
                <input maxLength={20} value={f.placas} onChange={set('placas')} />
              </Field>
            </div>
            <Field label={f.tipo === 'PAQUETERIA' ? 'Paquetería / remitente' : 'Nombre'}>
              <input required maxLength={120} value={f.nombre} onChange={set('nombre')} />
            </Field>
            <Field label="Notas (opcional)">
              <textarea maxLength={500} value={f.notas} onChange={set('notas')} />
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
          {modo === 'llegada' ? 'Registrar y alertar' : 'Enviar alerta'}
        </button>
      </form>
    </div>
  );
}

function ChatCaseta({ unidades }: { unidades: Panel['unidades'] }) {
  const hilos = useLoad(() => portal<{ unidadId: string; unidad: string; ultimo: Msg }[]>('caseta.hilos'));
  const [unidadId, setUnidadId] = useState('');
  usePoll(() => hilos.reload(true), 15000);
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
                    <strong>{h.unidad}</strong>
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
              enviar={(texto) => portal('caseta.enviar', { unidadId, texto })}
            />
          ) : (
            <Empty icon="chat">Selecciona una unidad para conversar.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

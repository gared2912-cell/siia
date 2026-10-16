import { useMemo, useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { ChatBox, type Msg } from '../ChatBox';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, fecha, fechaHora, useAction, useLoad, usePoll } from '../ui';
import { ModuloInactivo, useAdmin } from './AdminApp';
import { descargarReporteEncuesta } from './excel';

type Comunicado = Schema['Comunicado']['type'];
type Encuesta = Schema['Encuesta']['type'];
type Voto = Schema['Voto']['type'];
type Mensaje = Schema['Mensaje']['type'];

// ---------- Comunicados ----------
export function ComunicadosAdmin() {
  const { condo, puede } = useAdmin();
  const gestiona = puede('comunicados', 'editar');
  const { data, error, loading, reload } = useLoad(
    () => all<Comunicado>((o) => db.models.Comunicado.comunicadosPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const [editar, setEditar] = useState<Partial<Comunicado> | null>(null);
  const { run } = useAction();
  const borrar = (c: Comunicado) =>
    confirm(`¿Eliminar "${c.titulo}"?`) &&
    run(async () => {
      ok(await db.models.Comunicado.delete({ id: c.id }));
      reload(true);
    }, 'Comunicado eliminado');

  return (
    <div className="stack">
      <ModuloInactivo modulo="comunicados" />
      <PageHead icon="megaphone" title="Comunicados" sub={`Publicados para ${condo!.nombre}.`}>
        {gestiona && (
          <button className="btn-app" onClick={() => setEditar({})}>
            <Icon name="plus" />
            Nuevo comunicado
          </button>
        )}
      </PageHead>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : data!.length ? (
        [...data!]
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .map((c) => (
            <article key={c.id} className="panel">
              <div className="panel-head">
                <h2>
                  {c.titulo} {c.importante && <Badge estado="RECHAZADO">Importante</Badge>}
                </h2>
                {gestiona && (
                  <div className="row-actions">
                    <button className="linklike" onClick={() => setEditar(c)}>
                      Editar
                    </button>
                    <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrar(c)}>
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
              <div className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
                {fechaHora(c.createdAt)} {c.autor && `· ${c.autor}`}
              </div>
              <p className="pre" style={{ margin: 0 }}>
                {c.cuerpo}
              </p>
            </article>
          ))
      ) : (
        <section className="panel">
          <Empty icon="megaphone">Sin comunicados.</Empty>
        </section>
      )}
      {editar && <EditarComunicado c={editar} onClose={() => setEditar(null)} onDone={() => (setEditar(null), reload(true))} />}
    </div>
  );
}

function EditarComunicado({ c, onClose, onDone }: { c: Partial<Comunicado>; onClose: () => void; onDone: () => void }) {
  const { condoId, yo } = useAdmin();
  const [f, setF] = useState({ titulo: c.titulo ?? '', cuerpo: c.cuerpo ?? '', importante: !!c.importante });
  const [notificar, setNotificar] = useState(!c.id);
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      if (c.id) ok(await db.models.Comunicado.update({ id: c.id, ...f }));
      else ok(await db.models.Comunicado.create({ condominioId: condoId, autor: yo, ...f }));
      if (notificar) await adminCall('avisar', { condominioId: condoId, tipo: 'COMUNICADO', titulo: `Nuevo comunicado: ${f.titulo}`, texto: f.cuerpo.slice(0, 200) });
    }, 'Comunicado publicado');
    if (okk) onDone();
  }
  return (
    <Modal title={c.id ? 'Editar comunicado' : 'Nuevo comunicado'} onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        <Field label="Título">
          <input required maxLength={140} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
        </Field>
        <Field label="Mensaje">
          <textarea required rows={8} maxLength={8000} value={f.cuerpo} onChange={(e) => setF({ ...f, cuerpo: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.importante} onChange={(e) => setF({ ...f, importante: e.target.checked })} />
          Marcar como importante
        </label>
        <label className="check">
          <input type="checkbox" checked={notificar} onChange={(e) => setNotificar(e.target.checked)} />
          Enviar aviso a todas las unidades
        </label>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Publicando…' : 'Publicar'}
        </button>
      </form>
    </Modal>
  );
}

// ---------- Encuestas ----------
export function EncuestasAdmin() {
  const { condo, unidades, puede } = useAdmin();
  const gestiona = puede('encuestas', 'editar');
  const [descargando, setDescargando] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const encuestas = await all<Encuesta>((o) => db.models.Encuesta.encuestasPorCondominio({ condominioId: condo!.id }, o));
    const votos = await Promise.all(encuestas.map((e) => all<Voto>((o) => db.models.Voto.votosPorEncuesta({ encuestaId: e.id }, o))));
    return encuestas
      .map((e, i) => ({ e, votos: votos[i] }))
      .sort((a, b) => String(b.e.createdAt).localeCompare(String(a.e.createdAt)));
  }, [condo!.id]);
  const [nueva, setNueva] = useState(false);
  const { run } = useAction();

  const cerrar = (e: Encuesta) =>
    run(async () => {
      ok(await db.models.Encuesta.update({ id: e.id, estado: e.estado === 'CERRADA' ? 'ABIERTA' : 'CERRADA' }));
      reload(true);
    }, e.estado === 'CERRADA' ? 'Encuesta reabierta' : 'Encuesta cerrada');
  const borrar = (e: Encuesta) =>
    confirm('¿Eliminar la encuesta y sus votos?') &&
    run(async () => {
      ok(await db.models.Encuesta.delete({ id: e.id }));
      reload(true);
    }, 'Encuesta eliminada');
  // Excel de una encuesta cerrada: ganador, votos por opción, quién votó y por cuál opción, y quién no votó.
  const excel = (e: Encuesta, votos: Voto[]) =>
    run(async () => {
      setDescargando(e.id);
      try {
        const nombres = await adminCall<Record<string, { nombre: string | null; email: string | null }>>('encuestas.votantes', { encuestaId: e.id });
        await descargarReporteEncuesta({
          condominio: condo!.nombre,
          pregunta: e.pregunta,
          descripcion: e.descripcion,
          cierra: e.cierra ? fecha(e.cierra) : null,
          opciones: (e.opciones ?? []).filter((o): o is string => !!o),
          unidades: unidades.map((u) => ({ id: u.id, etiqueta: u.etiqueta })),
          votos: votos.map((v) => ({ unidadId: v.unidadId, opcion: v.opcion, createdAt: v.createdAt, ...(v.userId ? nombres[v.userId] : {}) })),
        });
      } finally {
        setDescargando(null);
      }
    }, 'Reporte descargado');

  return (
    <div className="stack">
      <ModuloInactivo modulo="encuestas" />
      <PageHead icon="vote" title="Encuestas" sub="Votaciones electrónicas: un voto por unidad.">
        {gestiona && (
          <button className="btn-app" onClick={() => setNueva(true)}>
            <Icon name="plus" />
            Nueva encuesta
          </button>
        )}
      </PageHead>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : data!.length ? (
        data!.map(({ e, votos }) => (
          <article key={e.id} className="panel">
            <div className="panel-head">
              <h2>{e.pregunta}</h2>
              <div className="row-actions">
                <Badge estado={e.estado} />
                {gestiona && (
                  <>
                    <button className="linklike" onClick={() => cerrar(e)}>
                      {e.estado === 'CERRADA' ? 'Reabrir' : 'Cerrar'}
                    </button>
                    <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrar(e)}>
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
            {e.descripcion && <p className="small pre">{e.descripcion}</p>}
            {e.estado === 'CERRADA' && (
              <div className="row-actions" style={{ marginBottom: 8 }}>
                <button className="btn-app sm secondary" disabled={descargando === e.id} onClick={() => excel(e, votos)}>
                  <Icon name="download" />
                  {descargando === e.id ? 'Generando…' : 'Descargar resultados en Excel'}
                </button>
              </div>
            )}
            <p className="small muted">
              Participación: {votos.length} de {unidades.length} unidades {e.cierra && `· Cierra ${fecha(e.cierra)}`}
            </p>
            {(e.opciones ?? []).filter(Boolean).map((o) => {
              const n = votos.filter((v) => v.opcion === o).length;
              const pct = votos.length ? Math.round((n / votos.length) * 100) : 0;
              return (
                <div key={o} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{o}</span>
                    <span className="small muted">
                      {n} · {pct}%
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </article>
        ))
      ) : (
        <section className="panel">
          <Empty icon="vote">Sin encuestas.</Empty>
        </section>
      )}
      {nueva && <NuevaEncuesta onClose={() => setNueva(false)} onDone={() => (setNueva(false), reload(true))} />}
    </div>
  );
}

function NuevaEncuesta({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({ pregunta: '', descripcion: '', opciones: 'Sí\nNo', cierra: '' });
  const [notificar, setNotificar] = useState(true);
  const { run, busy } = useAction();
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const opciones = [...new Set(f.opciones.split('\n').map((s) => s.trim()).filter(Boolean))];
    const okk = await run(async () => {
      if (opciones.length < 2) throw new Error('Agrega al menos dos opciones.');
      ok(
        await db.models.Encuesta.create({
          condominioId: condoId,
          pregunta: f.pregunta,
          descripcion: f.descripcion || null,
          opciones,
          cierra: f.cierra || null,
          estado: 'ABIERTA',
        }),
      );
      if (notificar) await adminCall('avisar', { condominioId: condoId, tipo: 'ENCUESTA', titulo: `Nueva encuesta: ${f.pregunta}`, texto: 'Participa desde Comunicados › Encuestas.' });
    }, 'Encuesta publicada');
    if (okk) onDone();
  }
  return (
    <Modal title="Nueva encuesta" onClose={onClose}>
      <form className="form" onSubmit={crear}>
        <Field label="Pregunta">
          <input required maxLength={200} value={f.pregunta} onChange={(e) => setF({ ...f, pregunta: e.target.value })} />
        </Field>
        <Field label="Descripción (opcional)">
          <textarea maxLength={2000} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
        </Field>
        <Field label="Opciones" hint="Una por línea.">
          <textarea required value={f.opciones} onChange={(e) => setF({ ...f, opciones: e.target.value })} />
        </Field>
        <Field label="Fecha de cierre (opcional)">
          <input type="date" value={f.cierra} onChange={(e) => setF({ ...f, cierra: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={notificar} onChange={(e) => setNotificar(e.target.checked)} />
          Enviar aviso a todas las unidades
        </label>
        <button className="btn-app" disabled={busy}>
          Publicar encuesta
        </button>
      </form>
    </Modal>
  );
}

// ---------- Chat con residentes ----------
export function ChatAdmin({ onCambio }: { onCambio?: () => void }) {
  const { condo, unidades, etiqueta } = useAdmin();
  const cid = condo!.id;
  const hilos = useLoad(() => all<Mensaje>((o) => db.models.Mensaje.mensajesPorCondominio({ condominioId: cid }, o)), [cid]);
  usePoll(() => hilos.reload(true), 15000);
  const [unidadId, setUnidadId] = useState('');

  const recientes = useMemo(() => {
    const m = new Map<string, Mensaje>();
    [...(hilos.data ?? [])]
      .filter((x) => x.canal === 'ADMIN')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .forEach((x) => !m.has(x.unidadId) && m.set(x.unidadId, x));
    return [...m.values()];
  }, [hilos.data]);

  return (
    <div className="stack">
      <ModuloInactivo modulo="chat" />
      <PageHead icon="chat" title="Chat con residentes" sub="Conversaciones del canal de administración." />
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
          {recientes.length ? (
            <ul className="list">
              {recientes.map((m) => (
                <li key={m.unidadId} style={{ cursor: 'pointer' }} onClick={() => setUnidadId(m.unidadId)}>
                  <div className="list-main">
                    <strong>{etiqueta(m.unidadId)}</strong> {m.autorRol === 'RESIDENTE' && <Badge estado="PENDIENTE">Por responder</Badge>}
                    <div className="list-sub">
                      {m.texto.slice(0, 70)} · {fechaHora(m.createdAt)}
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
            <ChatUnidad key={unidadId} unidadId={unidadId} onEnviado={() => (hilos.reload(true), onCambio?.())} />
          ) : (
            <Empty icon="chat">Selecciona una unidad para conversar.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

/** Conversación de la administración con una unidad (canal ADMIN), con fotos. La usan Chat y Condominios › Residentes. */
export function ChatUnidad({ unidadId, onEnviado }: { unidadId: string; onEnviado?: () => void }) {
  const { condo, yo, puede } = useAdmin();
  const cid = condo!.id;
  const responde = puede('chat', 'editar');
  return (
    <ChatBox
      deps={[unidadId]}
      miRol="ADMIN"
      cargar={async () =>
        (await all<Mensaje>((o) => db.models.Mensaje.mensajesPorHilo({ hilo: `${cid}#${unidadId}#ADMIN` }, o)))
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
          .map(
            (m) =>
              ({
                id: m.id,
                texto: m.texto,
                autorNombre: m.autorNombre ?? '',
                autorRol: m.autorRol ?? '',
                createdAt: m.createdAt,
                imagenUrl: (m as Mensaje & { imagenUrl?: string }).imagenUrl,
              }) as Msg,
          )
      }
      enviar={
        !responde
          ? undefined
          : async (texto, imagen) => {
              // La foto se sube a la carpeta del condominio con una URL firmada de admin-api.
              let imagenPath: string | undefined;
              if (imagen) {
                const nombre = /\.[a-z0-9]+$/i.test(imagen.name) ? imagen.name : 'foto.jpg';
                const r = await adminCall<{ url: string; path: string; contentType: string }>('chat.subirImagen', { condominioId: cid, nombre, tamano: imagen.size });
                const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: imagen });
                if (!put.ok) throw new Error('No se pudo subir la foto. Intenta de nuevo.');
                imagenPath = r.path;
              }
              ok(
                await db.models.Mensaje.create({
                  condominioId: cid,
                  unidadId,
                  canal: 'ADMIN',
                  hilo: `${cid}#${unidadId}#ADMIN`,
                  autorNombre: 'Administración SIIA',
                  autorRol: 'ADMIN',
                  autorId: yo,
                  texto,
                  imagenPath,
                }),
              );
              onEnviado?.();
            }
      }
    />
  );
}

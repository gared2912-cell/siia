import { useEffect, useMemo, useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { ChatBox, type Msg } from '../ChatBox';
import { ComunicadoCompleto, TarjetaComunicado, type Adjunto } from '../ComunicadoVista';
import { nombreAdjunto } from '../../../amplify/functions/shared/comunicados';
import { ElegirArchivo } from '../ElegirArchivo';
import { Acciones, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tarjeta, TarjetaIcono, Tarjetas, fecha, fechaHora, useAction, useLoad, usePoll } from '../ui';
import { Firma, leerFirma } from './Firma';
import { ModuloInactivo, useAdmin } from './AdminApp';
import { descargarReporteEncuesta } from './excel';
import { marcarVisto } from '../Campana';
import { VISTOS_ADMIN } from './CampanaAdmin';

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
            <ComunicadoAdmin
              key={c.id}
              c={c}
              acciones={
                gestiona && (
                  <>
                    <button className="btn-app secondary" onClick={() => setEditar(c)}>
                      Editar
                    </button>
                    <button className="btn-app danger" onClick={() => borrar(c)}>
                      <Icon name="trash" />
                      Eliminar
                    </button>
                  </>
                )
              }
            />
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

const MAX_IMAGENES = 6;
const MAX_PDF = 5;
const rutas = (v?: (string | null)[] | null) => (v ?? []).filter((x): x is string => !!x);
const esPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
type ArchivosComunicado = { imagenes: string[]; adjuntos: Adjunto[] };
const archivosDe = (c: Partial<Comunicado>): Promise<ArchivosComunicado> =>
  c.id && (rutas(c.imagenes).length || rutas(c.adjuntos).length)
    ? adminCall<ArchivosComunicado>('comunicados.archivos', { id: c.id })
    : Promise.resolve({ imagenes: [], adjuntos: [] });

/** Comunicado en la lista del panel: tarjeta que se abre con el texto completo, las imágenes y los PDF. */
function ComunicadoAdmin({ c, acciones }: { c: Comunicado; acciones: React.ReactNode }) {
  const archivos = useLoad(() => archivosDe(c), [c.id, c.updatedAt]);
  const [abierto, setAbierto] = useState(false);
  const datos = { ...c, createdAt: String(c.createdAt) };
  const urls = archivos.data?.imagenes ?? [];
  const adjuntos = archivos.data?.adjuntos ?? [];
  return (
    <>
      <TarjetaComunicado
        c={datos}
        urls={urls}
        adjuntos={adjuntos}
        onAbrir={() => setAbierto(true)}
        firma={<Firma item={c} alta="Publicado por" altaAntes={c.autor} />}
      />
      {abierto && (
        <ComunicadoCompleto
          c={datos}
          urls={urls}
          adjuntos={adjuntos}
          onClose={() => setAbierto(false)}
          pie={
            <>
              <Firma item={c} alta="Publicado por" altaAntes={c.autor} />
              {acciones && <Acciones>{acciones}</Acciones>}
            </>
          }
        />
      )}
    </>
  );
}

function EditarComunicado({ c, onClose, onDone }: { c: Partial<Comunicado>; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({ titulo: c.titulo ?? '', cuerpo: c.cuerpo ?? '', importante: !!c.importante });
  const [notificar, setNotificar] = useState(!c.id);
  const [porCorreo, setPorCorreo] = useState(false);
  // Archivos ya guardados (ruta + URL temporal para verlos) y nuevos por subir, en el orden en que se muestran
  const guardadas = useLoad(
    async () => {
      const a = await archivosDe(c);
      return {
        imagenes: rutas(c.imagenes).map((path, i) => ({ path, url: a.imagenes[i] })),
        pdfs: rutas(c.adjuntos).map((path) => ({ path, nombre: nombreAdjunto(path) })),
      };
    },
    [c.id],
  );
  const [quitadas, setQuitadas] = useState<string[]>([]);
  const [nuevas, setNuevas] = useState<{ file: File; url: string }[]>([]);
  const [nuevosPdf, setNuevosPdf] = useState<File[]>([]);
  const { run, busy } = useAction();
  const actuales = (guardadas.data?.imagenes ?? []).filter((g) => !quitadas.includes(g.path));
  const pdfsActuales = (guardadas.data?.pdfs ?? []).filter((g) => !quitadas.includes(g.path));
  const totalImg = actuales.length + nuevas.length;
  const totalPdf = pdfsActuales.length + nuevosPdf.length;

  useEffect(() => () => nuevas.forEach((n) => URL.revokeObjectURL(n.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const agregar = (files: File[]) => {
    const pdfs = files.filter(esPdf);
    const imgs = files.filter((x) => !esPdf(x));
    const cabenImg = imgs.slice(0, MAX_IMAGENES - totalImg);
    const cabenPdf = pdfs.slice(0, MAX_PDF - totalPdf);
    if (imgs.length > cabenImg.length) alert(`Máximo ${MAX_IMAGENES} imágenes por comunicado.`);
    if (pdfs.length > cabenPdf.length) alert(`Máximo ${MAX_PDF} PDF por comunicado.`);
    setNuevas([...nuevas, ...cabenImg.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    setNuevosPdf([...nuevosPdf, ...cabenPdf]);
  };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      const subir = async (file: File) => {
        const nombre = file.name || 'imagen.jpg';
        const r = await adminCall<{ url: string; path: string; contentType: string }>('comunicados.subirArchivo', {
          condominioId: condoId,
          nombre: /\.[a-z0-9]+$/i.test(nombre) ? nombre : `${nombre}.jpg`,
          tamano: file.size,
        });
        const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: file });
        if (!put.ok) throw new Error(`No se pudo subir «${nombre}». Intenta de nuevo.`);
        return r.path;
      };
      const subidas: string[] = [];
      for (const n of nuevas) subidas.push(await subir(n.file));
      const pdfsSubidos: string[] = [];
      for (const p of nuevosPdf) pdfsSubidos.push(await subir(p));
      await adminCall('comunicados.guardar', {
        condominioId: condoId,
        id: c.id,
        ...f,
        // Solo los importantes pueden ir también por correo.
        correo: f.importante && notificar && porCorreo,
        imagenes: [...actuales.map((g) => g.path), ...subidas],
        adjuntos: [...pdfsActuales.map((g) => g.path), ...pdfsSubidos],
      });
      if (notificar) await adminCall('avisar', { condominioId: condoId, tipo: 'COMUNICADO', titulo: `Nuevo comunicado: ${f.titulo}`, texto: f.cuerpo.slice(0, 200) });
    }, f.importante && notificar && porCorreo ? 'Comunicado publicado y enviado por correo' : 'Comunicado publicado');
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
        <Field
          grupo
          label="Imágenes y PDF (opcional)"
          hint={`Hasta ${MAX_IMAGENES} imágenes (se ven en grande) y ${MAX_PDF} PDF (convocatorias, invitaciones, orden del día), máximo 10 MB cada uno. Los residentes descargan los PDF desde su app.`}
        >
          <ElegirArchivo pdf multiple disabled={busy || (totalImg >= MAX_IMAGENES && totalPdf >= MAX_PDF)} onChange={agregar} />
          {(pdfsActuales.length > 0 || nuevosPdf.length > 0) && (
            <ul className="comunicado-descargas">
              {pdfsActuales.map((g) => (
                <li key={g.path}>
                  <Icon name="file" />
                  <span>{g.nombre}</span>
                  <button type="button" className="linklike" style={{ color: 'var(--danger)' }} onClick={() => setQuitadas([...quitadas, g.path])}>
                    Quitar
                  </button>
                </li>
              ))}
              {nuevosPdf.map((p, i) => (
                <li key={`${p.name}-${i}`}>
                  <Icon name="file" />
                  <span>
                    {p.name} <span className="muted small">· nuevo</span>
                  </span>
                  <button type="button" className="linklike" style={{ color: 'var(--danger)' }} onClick={() => setNuevosPdf(nuevosPdf.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {guardadas.loading && !guardadas.data ? (
            <span className="small muted">Cargando archivos…</span>
          ) : (
            totalImg > 0 && (
              <div className="comunicado-editar-imgs">
                {actuales.map((g) => (
                  <figure key={g.path}>
                    {g.url ? <img src={g.url} alt="" /> : <span className="photo-thumb" />}
                    <button type="button" className="linklike" style={{ color: 'var(--danger)' }} onClick={() => setQuitadas([...quitadas, g.path])}>
                      Quitar
                    </button>
                  </figure>
                ))}
                {nuevas.map((n, i) => (
                  <figure key={n.url}>
                    <img src={n.url} alt="" />
                    <button
                      type="button"
                      className="linklike"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => (URL.revokeObjectURL(n.url), setNuevas(nuevas.filter((_, j) => j !== i)))}
                    >
                      Quitar
                    </button>
                  </figure>
                ))}
              </div>
            )
          )}
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.importante} onChange={(e) => setF({ ...f, importante: e.target.checked })} />
          Marcar como importante
        </label>
        <label className="check">
          <input type="checkbox" checked={notificar} onChange={(e) => setNotificar(e.target.checked)} />
          Enviar aviso a todas las unidades
        </label>
        {f.importante && notificar && (
          <Field label="¿Cómo se avisa a los residentes?" hint="Por ser importante, también puedes enviarlo al correo de cada residente, con el diseño de SIIA.">
            <select value={porCorreo ? 'AMBOS' : 'NOTIFICACION'} onChange={(e) => setPorCorreo(e.target.value === 'AMBOS')}>
              <option value="NOTIFICACION">Solo notificación (portal y app)</option>
              <option value="AMBOS">Notificación y correo</option>
            </select>
          </Field>
        )}
        <button className="btn-app" disabled={busy}>
          {busy ? 'Publicando…' : 'Publicar'}
        </button>
      </form>
    </Modal>
  );
}

// ---------- Encuestas ----------
export function EncuestasAdmin() {
  const { condo, unidades, puede, firmaReporte } = useAdmin();
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
  const [ficha, setFicha] = useState<string | null>(null);
  const fichaE = data?.find((x) => x.e.id === ficha);
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
      setFicha(null);
      reload(true);
    }, 'Encuesta eliminada');
  // Excel de una encuesta cerrada: ganador, votos por opción, quién votó y por cuál opción, y quién no votó.
  const excel = (e: Encuesta, votos: Voto[]) =>
    run(async () => {
      setDescargando(e.id);
      try {
        const nombres = await adminCall<Record<string, { nombre: string | null; email: string | null }>>('encuestas.votantes', { encuestaId: e.id });
        await descargarReporteEncuesta({
          generadoPor: firmaReporte,
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
        <Tarjetas>
          {data!.map(({ e, votos }) => (
            <Tarjeta
              key={e.id}
              tono={e.estado === 'ABIERTA' ? 'info' : 'neutro'}
              onClick={() => setFicha(e.id)}
              media={<TarjetaIcono name="vote" />}
              titulo={e.pregunta}
              sub={`Participación: ${votos.length} de ${unidades.length} unidades${e.cierra ? ` · Cierra ${fecha(e.cierra)}` : ''}`}
              lado={<Badge estado={e.estado} />}
            >
              <span className="bar" style={{ marginTop: 4 }}>
                <i style={{ width: `${unidades.length ? Math.round((votos.length / unidades.length) * 100) : 0}%` }} />
              </span>
            </Tarjeta>
          ))}
        </Tarjetas>
      ) : (
        <section className="panel">
          <Empty icon="vote">Sin encuestas.</Empty>
        </section>
      )}
      {fichaE && (
        <Modal title={fichaE.e.pregunta} onClose={() => setFicha(null)} wide>
          <div className="stack">
            <div>
              <Badge estado={fichaE.e.estado} />
            </div>
            {fichaE.e.descripcion && <p className="small pre" style={{ margin: 0 }}>{fichaE.e.descripcion}</p>}
            <p className="small muted" style={{ margin: 0 }}>
              Participación: {fichaE.votos.length} de {unidades.length} unidades {fichaE.e.cierra && `· Cierra ${fecha(fichaE.e.cierra)}`}
            </p>
            <div>
              {(fichaE.e.opciones ?? []).filter(Boolean).map((o) => {
                const n = fichaE.votos.filter((v) => v.opcion === o).length;
                const pct = fichaE.votos.length ? Math.round((n / fichaE.votos.length) * 100) : 0;
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
            </div>
            <Firma item={fichaE.e} alta="Creada por" cambio={fichaE.e.estado === 'CERRADA' ? 'Cerrada por' : undefined} />
            {(gestiona || fichaE.e.estado === 'CERRADA') && (
              <Acciones>
                {fichaE.e.estado === 'CERRADA' && (
                  <button className="btn-app secondary" disabled={descargando === fichaE.e.id} onClick={() => excel(fichaE.e, fichaE.votos)}>
                    <Icon name="download" />
                    {descargando === fichaE.e.id ? 'Generando…' : 'Descargar resultados en Excel'}
                  </button>
                )}
                {gestiona && (
                  <>
                    <button className="btn-app secondary" onClick={() => cerrar(fichaE.e)}>
                      {fichaE.e.estado === 'CERRADA' ? 'Reabrir encuesta' : 'Cerrar encuesta'}
                    </button>
                    <button className="btn-app danger" onClick={() => borrar(fichaE.e)}>
                      <Icon name="trash" />
                      Eliminar
                    </button>
                  </>
                )}
              </Acciones>
            )}
          </div>
        </Modal>
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
/** `inicial`: conversación que abre (unidad), desde la campana o la notificación push. */
export function ChatAdmin({ onCambio, inicial }: { onCambio?: () => void; inicial?: string }) {
  const { condo, unidades, etiqueta } = useAdmin();
  const cid = condo!.id;
  const hilos = useLoad(() => all<Mensaje>((o) => db.models.Mensaje.mensajesPorCondominio({ condominioId: cid }, o)), [cid]);
  usePoll(() => hilos.reload(true), 15000);
  const [unidadId, setUnidadId] = useState(inicial ?? '');
  // Abrir la conversación la marca como revisada en la campana
  useEffect(() => {
    if (unidadId) marcarVisto(VISTOS_ADMIN, `chat-${unidadId}`);
  }, [unidadId, hilos.data]);

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
            <Tarjetas>
              {recientes.map((m) => (
                <Tarjeta
                  key={m.unidadId}
                  tono={m.autorRol === 'RESIDENTE' ? 'warn' : m.unidadId === unidadId ? 'info' : 'neutro'}
                  onClick={() => setUnidadId(m.unidadId)}
                  titulo={etiqueta(m.unidadId)}
                  sub={`${m.texto.slice(0, 70)} · ${fechaHora(m.createdAt)}`}
                  lado={m.autorRol === 'RESIDENTE' ? <Badge estado="PENDIENTE">Por responder</Badge> : undefined}
                />
              ))}
            </Tarjetas>
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
                // Entre administradores se ve quién escribió; el residente solo ve «Administración SIIA».
                autorNombre: (m.autorRol === 'ADMIN' && leerFirma(m.firma)?.nombre) || m.autorNombre || '',
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

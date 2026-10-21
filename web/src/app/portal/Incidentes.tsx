import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { ElegirArchivo } from '../ElegirArchivo';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, VerImagen, etiquetaEstado, fecha, fechaHora, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

type Incidente = {
  id: string;
  categoria?: string;
  titulo: string;
  descripcion?: string;
  ubicacion?: string;
  fotoPath?: string;
  fotoUrl?: string | null;
  estado: string;
  respuesta?: string;
  createdAt: string;
  updatedAt: string;
  // Etapas que registró la administración, con su foto de evidencia (URL temporal)
  seguimiento?: { estado: string; respuesta?: string | null; en: string; reabierto?: boolean; foto?: string | null; fotoPdf?: boolean }[];
};
type Mant = { id: string; titulo: string; tipo?: string; area?: string; fecha?: string; estado?: string; proveedor?: string; notas?: string };

const esImagen = (path?: string) => /\.(png|jpe?g|webp|gif|heic)$/i.test(path ?? '');

export const CATEGORIAS = ['Alumbrado', 'Agua / fugas', 'Áreas verdes', 'Limpieza', 'Seguridad', 'Accesos / portones', 'Ruido / convivencia', 'Alberca', 'Otro'];

export function Incidentes(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Incidente[]>('incidentes.lista'));
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const actual = data?.find((i) => i.id === abierto);
  if (actual) return <Seguimiento i={actual} onBack={() => setAbierto(null)} />;
  return (
    <div className="stack">
      <PageHead icon="alert" title="Incidentes" sub="Reporta fallas en áreas comunes y da seguimiento.">
        <button className="btn-app" onClick={() => setNuevo(true)}>
          <Icon name="plus" />
          Reportar
        </button>
      </PageHead>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : <MisIncidentes lista={data!} abrir={setAbierto} />}
      {nuevo && (
        <NuevoIncidente
          onClose={() => setNuevo(false)}
          onDone={() => {
            setNuevo(false);
            reload(true);
          }}
        />
      )}
    </div>
  );
}

/** Mis reportes: cada uno abre su seguimiento completo. */
function MisIncidentes({ lista, abrir }: { lista: Incidente[]; abrir: (id: string) => void }) {
  return (
    <section className="panel">
      {lista.length ? (
        <ul className="list">
          {lista.map((i) => {
            const etapas = i.seguimiento?.length ?? 0;
            return (
              <li key={i.id} style={{ display: 'block' }}>
                <button type="button" className="fila-click" onClick={() => abrir(i.id)}>
                  {i.fotoUrl && esImagen(i.fotoPath) ? (
                    <img className="photo-thumb" src={i.fotoUrl} alt="" />
                  ) : (
                    <span className="tile-icon">
                      <Icon name={i.fotoPath ? 'file' : 'alert'} />
                    </span>
                  )}
                  <span className="list-main">
                    <strong>{i.titulo}</strong> <Badge estado={i.estado} />
                    <span className="list-sub" style={{ display: 'block' }}>
                      {i.categoria} · {fecha(i.createdAt)} {i.ubicacion && `· ${i.ubicacion}`}
                    </span>
                    <span className="small" style={{ display: 'block', color: 'var(--teal-dark)', marginTop: 2 }}>
                      {etapas
                        ? `Ver seguimiento (${etapas} ${etapas === 1 ? 'actualización' : 'actualizaciones'})`
                        : i.estado === 'ABIERTO'
                          ? 'Ver reporte · aún sin respuesta'
                          : 'Ver reporte'}
                    </span>
                  </span>
                  <Icon name="arrow" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon="alert">No has reportado incidentes.</Empty>
      )}
    </section>
  );
}

/** Seguimiento de un reporte: lo que reportó el residente y cada etapa de la administración con su foto. */
function Seguimiento({ i, onBack }: { i: Incidente; onBack: () => void }) {
  const [foto, setFoto] = useState<string | null>(null);
  const pasos = i.seguimiento ?? [];
  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onBack}>
          <Icon name="back" /> Mis reportes
        </button>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1.2rem' }}>{i.titulo}</h2>
          <Badge estado={i.estado} />
        </div>
        <p className="list-sub" style={{ marginTop: 0 }}>
          {i.categoria} · {fechaHora(i.createdAt)}
          {i.ubicacion && ` · ${i.ubicacion}`}
        </p>
        {i.descripcion && <p className="pre" style={{ margin: '0 0 12px' }}>{i.descripcion}</p>}
        {i.fotoUrl &&
          (esImagen(i.fotoPath) ? (
            <button type="button" onClick={() => setFoto(i.fotoUrl!)} title="Ver foto completa" style={{ border: 0, padding: 0, background: 'none', cursor: 'zoom-in', display: 'block' }}>
              <img src={i.fotoUrl} alt="Foto del reporte" style={{ width: 280, maxWidth: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
            </button>
          ) : (
            <a href={i.fotoUrl} target="_blank" rel="noopener" className="btn-app sm secondary">
              <Icon name="file" />
              Ver archivo del reporte
            </a>
          ))}
      </section>

      <section className="panel">
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Seguimiento</h2>
        <ol className="etapas">
          <li className="etapa">
            <strong>Reportado</strong> <span className="list-sub">· {fechaHora(i.createdAt)}</span>
          </li>
          {pasos.map((h, k) => (
            <li key={k} className="etapa">
              <strong>{etiquetaEstado(h.estado)}</strong> <span className="list-sub">· {fechaHora(h.en)}</span>
              {h.reabierto && (
                <div>
                  <Badge estado="PENDIENTE">Actualizado después del cierre</Badge>
                </div>
              )}
              {h.respuesta && <div className="small pre" style={{ margin: '4px 0' }}>{h.respuesta}</div>}
              {h.foto &&
                (h.fotoPdf ? (
                  <a href={h.foto} target="_blank" rel="noopener" className="btn-app sm secondary">
                    <Icon name="file" />
                    Ver evidencia (PDF)
                  </a>
                ) : (
                  <button type="button" onClick={() => setFoto(h.foto!)} title="Ver foto completa" style={{ border: 0, padding: 0, background: 'none', cursor: 'zoom-in', display: 'block' }}>
                    <img src={h.foto} alt={`Evidencia: ${etiquetaEstado(h.estado)}`} style={{ width: 240, maxWidth: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
                  </button>
                ))}
              <div className="small muted" style={{ marginTop: 4 }}>
                Administración
              </div>
            </li>
          ))}
        </ol>
        {/* Reportes anteriores a las etapas: solo guardaban la última respuesta */}
        {!pasos.length && i.respuesta && (
          <div className="alert small" style={{ marginTop: 12 }}>
            <strong>Administración:</strong> {i.respuesta}
          </div>
        )}
        {!pasos.length && i.estado === 'ABIERTO' && (
          <p className="small muted" style={{ margin: '12px 0 0' }}>
            La administración aún no responde este reporte. Te avisaremos cuando lo atienda.
          </p>
        )}
      </section>
      {foto && <VerImagen src={foto} alt="Foto de evidencia" onClose={() => setFoto(null)} />}
    </div>
  );
}

/** Módulo Mantenimientos: los programados en el condominio. */
export function Mantenimientos(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Mant[]>('mantenimientos.lista'));
  return (
    <div className="stack">
      <PageHead icon="tools" title="Mantenimientos" sub="Mantenimientos programados en tu condominio." />
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : <ListaMantenimientos lista={data!} />}
    </div>
  );
}

function ListaMantenimientos({ lista: data }: { lista: Mant[] }) {
  return (
    <section className="panel">
      {data!.length ? (
        <ul className="list">
          {data!.map((m) => (
            <li key={m.id}>
              <div className="tile-icon">
                <Icon name="tools" />
              </div>
              <div className="list-main">
                <strong>{m.titulo}</strong> <Badge estado={m.estado} />
                <div className="list-sub">
                  {m.tipo === 'CORRECTIVO' ? 'Correctivo' : 'Preventivo'} · {fecha(m.fecha)} {m.area && `· ${m.area}`}
                </div>
                {m.notas && <div className="small pre">{m.notas}</div>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="tools">Sin mantenimientos programados.</Empty>
      )}
    </section>
  );
}

function NuevoIncidente({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ categoria: CATEGORIAS[0], titulo: '', descripcion: '', ubicacion: '' });
  const [foto, setFoto] = useState<File | null>(null);
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      const fotoPath = foto ? await subirArchivo(foto, 'incidentes') : undefined;
      await portal('incidentes.crear', { ...f, fotoPath });
    }, 'Reporte enviado a la administración');
    if (okk) onDone();
  }

  return (
    <Modal title="Reportar incidente" onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <div className="form-2">
          <Field label="Categoría">
            <select value={f.categoria} onChange={set('categoria')}>
              {CATEGORIAS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Ubicación">
            <input maxLength={200} value={f.ubicacion} onChange={set('ubicacion')} placeholder="Ej. Frente a casa 20" />
          </Field>
        </div>
        <Field label="¿Qué sucede?">
          <input required maxLength={140} value={f.titulo} onChange={set('titulo')} placeholder="Ej. Lámpara fundida en andador" />
        </Field>
        <Field label="Detalles (opcional)">
          <textarea maxLength={3000} value={f.descripcion} onChange={set('descripcion')} />
        </Field>
        <Field grupo label="Foto o evidencia (opcional)" hint="Imagen o PDF, máximo 8 MB.">
          <ElegirArchivo pdf value={foto} onChange={(fs) => setFoto(fs[0] ?? null)} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar reporte'}
        </button>
      </form>
    </Modal>
  );
}

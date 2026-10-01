import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { Archivo, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, fecha, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

type Incidente = {
  id: string;
  categoria?: string;
  titulo: string;
  descripcion?: string;
  ubicacion?: string;
  fotoPath?: string;
  estado: string;
  respuesta?: string;
  createdAt: string;
  updatedAt: string;
};
type Mant = { id: string; titulo: string; tipo?: string; area?: string; fecha?: string; estado?: string; proveedor?: string; notas?: string };

export const CATEGORIAS = ['Alumbrado', 'Agua / fugas', 'Áreas verdes', 'Limpieza', 'Seguridad', 'Accesos / portones', 'Ruido / convivencia', 'Alberca', 'Otro'];

export function Incidentes({ has }: ModProps) {
  const tabs: ['incidentes' | 'mantenimientos', string][] = [];
  if (has('incidentes')) tabs.push(['incidentes', 'Mis reportes']);
  if (has('mantenimientos')) tabs.push(['mantenimientos', 'Mantenimientos']);
  const [tab, setTab] = useState(tabs[0][0]);
  const [nuevo, setNuevo] = useState(false);
  const [n, setN] = useState(0);
  return (
    <div className="stack">
      <PageHead icon={tab === 'incidentes' ? 'alert' : 'tools'} title={tab === 'incidentes' ? 'Incidentes' : 'Mantenimientos'} sub={tab === 'incidentes' ? 'Reporta fallas en áreas comunes y da seguimiento.' : 'Mantenimientos programados en tu condominio.'}>
        {tab === 'incidentes' && (
          <button className="btn-app" onClick={() => setNuevo(true)}>
            <Icon name="plus" />
            Reportar
          </button>
        )}
      </PageHead>
      {tabs.length > 1 && <Seg value={tab} onChange={setTab} options={tabs} />}
      {tab === 'incidentes' ? <MisIncidentes key={n} /> : <Mantenimientos />}
      {nuevo && (
        <NuevoIncidente
          onClose={() => setNuevo(false)}
          onDone={() => {
            setNuevo(false);
            setN(n + 1);
          }}
        />
      )}
    </div>
  );
}

function MisIncidentes() {
  const { data, error, loading, reload } = useLoad(() => portal<Incidente[]>('incidentes.lista'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <section className="panel">
      {data!.length ? (
        <ul className="list">
          {data!.map((i) => (
            <li key={i.id}>
              <Archivo path={i.fotoPath} thumb />
              <div className="list-main">
                <strong>{i.titulo}</strong> <Badge estado={i.estado} />
                <div className="list-sub">
                  {i.categoria} · {fecha(i.createdAt)} {i.ubicacion && `· ${i.ubicacion}`}
                </div>
                {i.descripcion && <div className="small pre">{i.descripcion}</div>}
                {i.respuesta && (
                  <div className="alert small" style={{ marginTop: 8 }}>
                    <strong>Administración:</strong> {i.respuesta}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="alert">No has reportado incidentes.</Empty>
      )}
    </section>
  );
}

function Mantenimientos() {
  const { data, error, loading, reload } = useLoad(() => portal<Mant[]>('mantenimientos.lista'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
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
        <Field label="Foto (opcional)">
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar reporte'}
        </button>
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { portal } from '../api';
import { Badge, Empty, ErrorBox, Loading, PageHead, Seg, fecha, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

type Comunicado = { id: string; titulo: string; cuerpo: string; importante?: boolean; createdAt: string };
type Encuesta = {
  id: string;
  pregunta: string;
  descripcion?: string;
  opciones: string[];
  cierra?: string;
  cerrada: boolean;
  miVoto: string | null;
  resultados: Record<string, number> | null;
  totalVotos: number;
};

export function Comunicados({ has }: ModProps) {
  const tabs: ['comunicados' | 'encuestas', string][] = [];
  if (has('comunicados')) tabs.push(['comunicados', 'Comunicados']);
  if (has('encuestas')) tabs.push(['encuestas', 'Encuestas']);
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <div className="stack">
      <PageHead icon={tab === 'comunicados' ? 'megaphone' : 'vote'} title={tab === 'comunicados' ? 'Comunicados' : 'Encuestas'} sub="Información y votaciones de la administración de tu condominio." />
      {tabs.length > 1 && <Seg value={tab} onChange={setTab} options={tabs} />}
      {tab === 'comunicados' ? <ListaComunicados /> : <Encuestas />}
    </div>
  );
}

function ListaComunicados() {
  const { data, error, loading, reload } = useLoad(() => portal<Comunicado[]>('comunicados.lista'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data!.length) return <section className="panel"><Empty icon="megaphone">Sin comunicados publicados.</Empty></section>;
  return (
    <>
      {data!.map((c) => (
        <article key={c.id} className="panel">
          <div className="panel-head">
            <h2>{c.titulo}</h2>
            {c.importante && <Badge estado="RECHAZADO">Importante</Badge>}
          </div>
          <div className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
            {fecha(c.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <p className="pre" style={{ margin: 0 }}>
            {c.cuerpo}
          </p>
        </article>
      ))}
    </>
  );
}

function Encuestas() {
  const { data, error, loading, reload } = useLoad(() => portal<Encuesta[]>('encuestas.lista'));
  const { run, busy } = useAction();
  const [sel, setSel] = useState<Record<string, string>>({});

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data!.length) return <section className="panel"><Empty icon="vote">No hay encuestas activas.</Empty></section>;

  const votar = (e: Encuesta) =>
    run(() => portal('encuestas.votar', { encuestaId: e.id, opcion: sel[e.id] }).then(() => reload(true)), 'Voto registrado');

  return (
    <>
      {data!.map((e) => (
        <article key={e.id} className="panel">
          <div className="panel-head">
            <h2>{e.pregunta}</h2>
            <Badge estado={e.cerrada ? 'CERRADA' : 'ABIERTA'} />
          </div>
          {e.descripcion && <p className="pre small">{e.descripcion}</p>}
          {e.cierra && <p className="small muted">Cierra el {fecha(e.cierra)}</p>}
          {e.resultados ? (
            <div className="stack">
              {e.opciones.map((o) => {
                const n = e.resultados![o] ?? 0;
                const pct = e.totalVotos ? Math.round((n / e.totalVotos) * 100) : 0;
                return (
                  <div key={o}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        {o} {e.miVoto === o && <Badge estado="APROBADO">Tu voto</Badge>}
                      </span>
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
              <p className="small muted">{e.totalVotos} voto(s). Un voto por unidad.</p>
            </div>
          ) : (
            <div className="form">
              {e.opciones.map((o) => (
                <label key={o} className="check">
                  <input type="radio" name={e.id} checked={sel[e.id] === o} onChange={() => setSel({ ...sel, [e.id]: o })} />
                  {o}
                </label>
              ))}
              <div>
                <button className="btn-app" disabled={!sel[e.id] || busy} onClick={() => votar(e)}>
                  Votar
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
    </>
  );
}

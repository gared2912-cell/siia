import { useState } from 'react';
import { itemDeAviso, useAvisos } from './Notificaciones';
import { ComunicadoCompleto, type Adjunto, type ComunicadoDatos } from '../ComunicadoVista';
import { ItemAviso } from '../Campana';
import { portal } from '../api';
import { Badge, Empty, ErrorBox, Icon, Loading, MODULOS, PageHead, fecha, money, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

type Resumen = {
  saldo: number;
  cargosVencidos: number;
  avisos: { id: string; titulo: string; texto?: string; tipo?: string; leido?: boolean; createdAt: string }[];
  avisosSinLeer: number;
  visitasHoy: number;
  proximasReservas: { id: string; fecha: string; horaInicio: string; horaFin: string; estado: string }[];
  comunicados: (ComunicadoDatos & { imagenUrls?: string[]; adjuntos?: Adjunto[] })[];
};

const DESTINO: Record<string, string> = {
  finanzas: 'finanzas',
  visitas: 'visitas',
  amenidades: 'amenidades',
  incidentes: 'incidentes',
  mantenimientos: 'mantenimientos',
  comunicados: 'comunicados',
  encuestas: 'comunicados',
  chat: 'chat',
  mascotas: 'mascotas',
};

export function Inicio({ perfil, go, has }: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Resumen>('inicio.resumen'));
  const avisos = useAvisos();
  const [comunicado, setComunicado] = useState<Resumen['comunicados'][number] | null>(null);
  const nombre = (perfil.perfil?.nombre ?? '').split(' ')[0];

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  // Los avisos vienen del proveedor compartido (misma fuente que la campana)
  const r = { ...data!, avisos: avisos.avisos.slice(0, 8), avisosSinLeer: avisos.sinLeer };
  const leer = avisos.leerTodo;

  return (
    <div className="stack">
      <PageHead icon="home" title={nombre ? `Hola, ${nombre}` : 'Bienvenido'} sub={`${perfil.unidad!.etiqueta} · ${perfil.condominio!.nombre}`} />

      <div className="grid-cards">
        {has('finanzas') && (
          <div className="stat">
            <div className="stat-label">Saldo pendiente</div>
            <div className={`stat-value ${r.saldo > 0 ? (r.cargosVencidos ? 'is-alert' : '') : 'is-ok'}`}>{money(r.saldo)}</div>
            <div className="small muted">{r.cargosVencidos ? `${r.cargosVencidos} cargo(s) vencido(s)` : r.saldo > 0 ? 'Al corriente' : 'Sin adeudos'}</div>
            <button className="linklike" onClick={() => go('finanzas')}>
              Ver estado de cuenta
            </button>
          </div>
        )}
        {has('visitas') && (
          <div className="stat">
            <div className="stat-label">Visitas de hoy</div>
            <div className="stat-value">{r.visitasHoy}</div>
            <div className="small muted">Pases vigentes o visitas dentro</div>
            <button className="linklike" onClick={() => go('visitas')}>
              Registrar visita
            </button>
          </div>
        )}
        {has('amenidades') && (
          <div className="stat">
            <div className="stat-label">Próximas reservas</div>
            <div className="stat-value">{r.proximasReservas.length}</div>
            <div className="small muted">
              {r.proximasReservas[0] ? `${fecha(r.proximasReservas[0].fecha)} · ${r.proximasReservas[0].horaInicio}` : 'Sin reservas'}
            </div>
            <button className="linklike" onClick={() => go('amenidades')}>
              Reservar amenidad
            </button>
          </div>
        )}
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>
              Avisos {r.avisosSinLeer > 0 && <span className="badge warn">{r.avisosSinLeer} nuevos</span>}
            </h2>
            {r.avisosSinLeer > 0 && (
              <button className="linklike" onClick={leer}>
                Marcar como leídos
              </button>
            )}
          </div>
          {avisos.avisos.some((a) => !a.leido) ? (
            <ul className="list avisos-lista">
              {avisos.avisos.filter((a) => !a.leido).slice(0, 8).map((a) => (
                <li key={a.id} className={a.leido ? '' : 'no-leido'}>
                  <ItemAviso item={itemDeAviso(a, avisos.abrir)} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="bell">No tienes avisos nuevos.</Empty>
          )}
        </section>

        <section className="panel">
          <h2>Servicios de tu condominio</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {MODULOS.filter((m) => has(m.key)).map((m) => (
              <button key={m.key} className="tile" onClick={() => go(DESTINO[m.key])}>
                <span className="tile-icon">
                  <Icon name={m.icon} />
                </span>
                <span>
                  <strong>{m.label}</strong>
                  <span>{m.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {has('comunicados') && r.comunicados.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Últimos comunicados</h2>
            <button className="linklike" onClick={() => go('comunicados')}>
              Ver todos
            </button>
          </div>
          <ul className="list">
            {r.comunicados.map((c) => (
              <li key={c.id}>
                <button type="button" className="fila-click" onClick={() => setComunicado(c)}>
                  {c.imagenUrls?.[0] && <img className="photo-thumb" src={c.imagenUrls[0]} alt="" loading="lazy" />}
                  <span className="list-main">
                    <strong>{c.titulo}</strong> {c.importante && <Badge estado="RECHAZADO">Importante</Badge>}
                    <span className="small muted" style={{ display: 'block' }}>
                      {fecha(c.createdAt)}
                    </span>
                    <span className="comunicado-resumen small">{c.cuerpo}</span>
                  </span>
                  <Icon name="arrow" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {comunicado && <ComunicadoCompleto c={comunicado} urls={comunicado.imagenUrls ?? []} adjuntos={comunicado.adjuntos} onClose={() => setComunicado(null)} />}
    </div>
  );
}

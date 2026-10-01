import { useAvisos } from './Notificaciones';
import { portal } from '../api';
import { Badge, Empty, ErrorBox, Icon, Loading, MODULOS, PageHead, fecha, fechaHora, money, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

type Resumen = {
  saldo: number;
  cargosVencidos: number;
  avisos: { id: string; titulo: string; texto?: string; tipo?: string; leido?: boolean; createdAt: string }[];
  avisosSinLeer: number;
  visitasHoy: number;
  proximasReservas: { id: string; fecha: string; horaInicio: string; horaFin: string; estado: string }[];
  comunicados: { id: string; titulo: string; cuerpo: string; importante?: boolean; createdAt: string }[];
};

const DESTINO: Record<string, string> = {
  finanzas: 'finanzas',
  visitas: 'visitas',
  amenidades: 'amenidades',
  incidentes: 'incidentes',
  mantenimientos: 'incidentes',
  comunicados: 'comunicados',
  encuestas: 'comunicados',
  chat: 'chat',
  mascotas: 'mascotas',
};

export function Inicio({ perfil, go, has }: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Resumen>('inicio.resumen'));
  const avisos = useAvisos();
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
          {r.avisos.length ? (
            <ul className="list">
              {r.avisos.map((a) => (
                <li key={a.id}>
                  <div className="tile-icon" style={{ width: 34, height: 34 }}>
                    <Icon name={a.tipo === 'CASETA' || a.tipo === 'VISITA' ? 'shield' : a.tipo === 'PAGO' ? 'money' : 'bell'} />
                  </div>
                  <div className="list-main">
                    <strong>{a.titulo}</strong> {!a.leido && <Badge estado="PENDIENTE">Nuevo</Badge>}
                    {a.texto && <div className="small">{a.texto}</div>}
                    <div className="list-sub">{fechaHora(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="bell">Sin avisos por ahora.</Empty>
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
                <div className="list-main">
                  <strong>{c.titulo}</strong> {c.importante && <Badge estado="RECHAZADO">Importante</Badge>}
                  <div className="small muted">{fecha(c.createdAt)}</div>
                  <div className="small pre">{c.cuerpo.length > 220 ? `${c.cuerpo.slice(0, 220)}…` : c.cuerpo}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

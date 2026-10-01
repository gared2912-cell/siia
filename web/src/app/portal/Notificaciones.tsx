// Notificaciones en la sesión del residente: campana con contador, lista desplegable y aviso emergente
// cuando llega algo nuevo (comprobante recibido, pago aprobado, visitas, paquetería…).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { portal } from '../api';
import { Icon, fechaHora, usePoll, useToast } from '../ui';

export type Aviso = { id: string; titulo: string; texto?: string; tipo?: string; leido?: boolean; createdAt: string };
type Estado = { sinLeer: number; avisos: Aviso[] };
type Ctx = Estado & { refrescar: () => void; leerTodo: () => Promise<void> };

const AvisosCtx = createContext<Ctx>({ sinLeer: 0, avisos: [], refrescar: () => {}, leerTodo: async () => {} });
export const useAvisos = () => useContext(AvisosCtx);

export function AvisosProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado>({ sinLeer: 0, avisos: [] });
  const vistos = useRef<Set<string> | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const r = await portal<Estado>('inicio.avisos');
      // Aviso emergente solo para lo que llegó después de abrir la sesión
      if (vistos.current) {
        const nuevos = r.avisos.filter((a) => !a.leido && !vistos.current!.has(a.id));
        if (nuevos.length === 1) toast(`🔔 ${nuevos[0].titulo}`);
        else if (nuevos.length > 1) toast(`🔔 Tienes ${nuevos.length} notificaciones nuevas`);
      }
      vistos.current = new Set(r.avisos.map((a) => a.id));
      setEstado(r);
    } catch {
      /* sin conexión: se reintenta en el siguiente ciclo */
    }
  }, [toast]);

  const leerTodo = useCallback(async () => {
    setEstado((e) => ({ sinLeer: 0, avisos: e.avisos.map((a) => ({ ...a, leido: true })) }));
    await portal('inicio.leerAvisos').catch(() => undefined);
    refrescar();
  }, [refrescar]);

  useEffect(() => {
    refrescar();
  }, [refrescar]);
  usePoll(refrescar, 30000);

  return <AvisosCtx.Provider value={{ ...estado, refrescar, leerTodo }}>{children}</AvisosCtx.Provider>;
}

const ICONO: Record<string, string> = { PAGO: 'money', CASETA: 'shield', VISITA: 'shield', RESERVA: 'calendar', INCIDENTE: 'alert', MASCOTA: 'paw', COMUNICADO: 'megaphone', ENCUESTA: 'vote' };

export function Campana() {
  const { sinLeer, avisos, leerTodo } = useAvisos();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [abierto]);

  return (
    <div className="campana" ref={ref}>
      <button
        className="icon-btn"
        onClick={() => setAbierto(!abierto)}
        aria-label={sinLeer ? `Notificaciones: ${sinLeer} sin leer` : 'Notificaciones'}
        aria-expanded={abierto}
      >
        <Icon name="bell" />
        {sinLeer > 0 && <span className="campana-n">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>
      {abierto && (
        <div className="campana-panel" role="dialog" aria-label="Notificaciones">
          <div className="campana-head">
            <strong>Notificaciones</strong>
            {sinLeer > 0 && (
              <button className="linklike" onClick={leerTodo}>
                Marcar todo como leído
              </button>
            )}
          </div>
          {avisos.length ? (
            <ul className="list campana-lista">
              {avisos.map((a) => (
                <li key={a.id} className={a.leido ? '' : 'no-leido'}>
                  <span className="tile-icon" style={{ width: 32, height: 32 }}>
                    <Icon name={ICONO[a.tipo ?? ''] ?? 'bell'} />
                  </span>
                  <div className="list-main">
                    <strong>{a.titulo}</strong>
                    {a.texto && <div className="small">{a.texto}</div>}
                    <div className="list-sub">{fechaHora(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small" style={{ padding: 16, margin: 0 }}>
              Sin notificaciones.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

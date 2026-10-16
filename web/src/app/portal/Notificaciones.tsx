// Notificaciones en la sesión del residente: campana con contador, lista desplegable y aviso emergente
// cuando llega algo nuevo (comprobante recibido, pago aprobado, visitas, paquetería…).
// El contador suma los avisos sin leer y los mensajes de chat que el residente aún no abre; ese total
// también va al icono de la app instalada.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { portal } from '../api';
import { Icon, fechaHora, usePoll, useToast } from '../ui';
import { useInsigniaApp } from '../AppMovil';

export type Aviso = { id: string; titulo: string; texto?: string; tipo?: string; leido?: boolean; createdAt: string; imagen?: string };
export type ChatSinLeer = { ADMIN: number; CASETA: number };
type Estado = { sinLeer: number; avisos: Aviso[]; chat: ChatSinLeer };
/** `total`: avisos sin leer + mensajes de chat sin leer (campana e icono de la app). */
type Ctx = Estado & { total: number; chatSinLeer: number; refrescar: () => void; leerTodo: () => Promise<void> };

const SIN_CHAT: ChatSinLeer = { ADMIN: 0, CASETA: 0 };
const AvisosCtx = createContext<Ctx>({ sinLeer: 0, avisos: [], chat: SIN_CHAT, total: 0, chatSinLeer: 0, refrescar: () => {}, leerTodo: async () => {} });
export const useAvisos = () => useContext(AvisosCtx);

export function AvisosProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado>({ sinLeer: 0, avisos: [], chat: SIN_CHAT });
  const vistos = useRef<Set<string> | null>(null);
  const chatAntes = useRef<ChatSinLeer | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const r = await portal<Estado>('inicio.avisos');
      r.chat = r.chat ?? SIN_CHAT;
      // Aviso emergente solo para lo que llegó después de abrir la sesión
      if (vistos.current) {
        const nuevos = r.avisos.filter((a) => !a.leido && !vistos.current!.has(a.id));
        if (nuevos.length === 1) toast(`🔔 ${nuevos[0].titulo}`);
        else if (nuevos.length > 1) toast(`🔔 Tienes ${nuevos.length} notificaciones nuevas`);
      }
      vistos.current = new Set(r.avisos.map((a) => a.id));
      // Mensajes nuevos de chat (si no está ya en la conversación)
      if (chatAntes.current && !location.hash.includes('chat')) {
        if (r.chat.ADMIN > chatAntes.current.ADMIN) toast('💬 Nuevo mensaje de la administración');
        else if (r.chat.CASETA > chatAntes.current.CASETA) toast('💬 Nuevo mensaje de la caseta');
      }
      chatAntes.current = r.chat;
      setEstado(r);
    } catch {
      /* sin conexión: se reintenta en el siguiente ciclo */
    }
  }, [toast]);

  const leerTodo = useCallback(async () => {
    setEstado((e) => ({ ...e, sinLeer: 0, avisos: e.avisos.map((a) => ({ ...a, leido: true })) }));
    await portal('inicio.leerAvisos').catch(() => undefined);
    refrescar();
  }, [refrescar]);

  useEffect(() => {
    refrescar();
  }, [refrescar]);
  usePoll(refrescar, 30000);

  const chatSinLeer = estado.chat.ADMIN + estado.chat.CASETA;
  const total = estado.sinLeer + chatSinLeer;
  useInsigniaApp(total);

  return <AvisosCtx.Provider value={{ ...estado, total, chatSinLeer, refrescar, leerTodo }}>{children}</AvisosCtx.Provider>;
}

const ICONO: Record<string, string> = { PAGO: 'money', CASETA: 'shield', VISITA: 'shield', RESERVA: 'calendar', INCIDENTE: 'alert', MASCOTA: 'paw', COMUNICADO: 'megaphone', ENCUESTA: 'vote' };

export function Campana() {
  const { sinLeer, total, chat, chatSinLeer, avisos, leerTodo } = useAvisos();
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
        aria-label={total ? `Notificaciones: ${total} sin leer` : 'Notificaciones'}
        aria-expanded={abierto}
      >
        <Icon name="bell" />
        {total > 0 && <span className="campana-n">{total > 99 ? '99+' : total}</span>}
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
          {chatSinLeer > 0 && (
            <ul className="list campana-lista">
              {(['ADMIN', 'CASETA'] as const)
                .filter((c) => chat[c] > 0)
                .map((c) => (
                  <li key={c} className="no-leido" style={{ cursor: 'pointer' }} onClick={() => (setAbierto(false), (location.hash = '/chat'))}>
                    <span className="tile-icon" style={{ width: 32, height: 32 }}>
                      <Icon name="chat" />
                    </span>
                    <div className="list-main">
                      <strong>
                        {chat[c] === 1 ? '1 mensaje nuevo' : `${chat[c]} mensajes nuevos`} de {c === 'ADMIN' ? 'la administración' : 'la caseta'}
                      </strong>
                      <div className="small">Toca para abrir el chat.</div>
                    </div>
                  </li>
                ))}
            </ul>
          )}
          {avisos.length ? (
            <ul className="list campana-lista">
              {avisos.map((a) => (
                <li key={a.id} className={a.leido ? '' : 'no-leido'}>
                  <span className="tile-icon" style={{ width: 32, height: 32 }}>
                    <Icon name={ICONO[a.tipo ?? ''] ?? 'bell'} />
                  </span>
                  <div className="list-main">
                    <strong>{a.titulo}</strong>
                    {a.imagen && <img className="aviso-imagen" src={a.imagen} alt="" loading="lazy" />}
                    {a.texto && <div className="small">{a.texto}</div>}
                    <div className="list-sub">{fechaHora(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            !chatSinLeer && <p className="muted small" style={{ padding: 16, margin: 0 }}>
              Sin notificaciones.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

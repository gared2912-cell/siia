// Notificaciones en la sesión del residente: campana con contador, lista desplegable y aviso emergente
// cuando llega algo nuevo (comprobante recibido, pago aprobado, visitas, paquetería…).
// El contador suma los avisos sin leer y los mensajes de chat que el residente aún no abre; ese total
// también va al icono de la app instalada.
// Tocar un aviso lo marca como leído (desaparece de la campana y de la bandeja del teléfono) y lleva a la sección donde se atiende; los avisos con imagen o sin
// sección (aviso de servicios, alertas de caseta) se abren completos, con la imagen en grande.
// La notificación push abre /portal/#aviso/<id> y hace lo mismo.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { portal } from '../api';
import { Icon, Modal, VerImagen, fechaHora, usePoll, useToast } from '../ui';
import { useInsigniaApp } from '../AppMovil';
import { Campana as CampanaBase, cerrarNotificaciones, type ItemCampana } from '../Campana';

export type Aviso = { id: string; titulo: string; texto?: string; tipo?: string; leido?: boolean; createdAt: string; imagen?: string };
export type ChatSinLeer = { ADMIN: number; CASETA: number };
type Estado = { sinLeer: number; avisos: Aviso[]; chat: ChatSinLeer };
/** `total`: avisos sin leer + mensajes de chat sin leer (campana e icono de la app). */
type Ctx = Estado & { total: number; chatSinLeer: number; refrescar: () => void; leerTodo: () => Promise<void>; abrir: (a: Aviso) => void };

const SIN_CHAT: ChatSinLeer = { ADMIN: 0, CASETA: 0 };
const AvisosCtx = createContext<Ctx>({ sinLeer: 0, avisos: [], chat: SIN_CHAT, total: 0, chatSinLeer: 0, refrescar: () => {}, leerTodo: async () => {}, abrir: () => {} });
export const useAvisos = () => useContext(AvisosCtx);

/** Sección del portal donde se atiende cada tipo de aviso. Sin sección, el aviso se muestra completo. */
const DESTINO: Record<string, { key: string; label: string }> = {
  PAGO: { key: 'finanzas', label: 'Ir a Finanzas' },
  VISITA: { key: 'visitas', label: 'Ir a Visitas' },
  ACCESO: { key: 'visitas', label: 'Autorizar en Visitas' },
  RESERVA: { key: 'amenidades', label: 'Ir a Reservas' },
  INCIDENTE: { key: 'incidentes', label: 'Ir a Incidentes' },
  MASCOTA: { key: 'mascotas', label: 'Ir a Mascotas' },
  COMUNICADO: { key: 'comunicados', label: 'Ir a Comunicados' },
  ENCUESTA: { key: 'comunicados', label: 'Ir a Comunicados' },
};

export const ICONO_AVISO: Record<string, string> = {
  PAGO: 'money',
  CASETA: 'shield',
  VISITA: 'shield',
  ACCESO: 'shield',
  SERVICIO: 'shield',
  RESERVA: 'calendar',
  INCIDENTE: 'alert',
  MASCOTA: 'paw',
  COMUNICADO: 'megaphone',
  ENCUESTA: 'vote',
};

const avisoDeHash = () => decodeURIComponent(location.hash.match(/aviso\/([^/?]+)/)?.[1] ?? '');

export function AvisosProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado>({ sinLeer: 0, avisos: [], chat: SIN_CHAT });
  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState<Aviso | null>(null);
  const vistos = useRef<Set<string> | null>(null);
  const chatAntes = useRef<ChatSinLeer | null>(null);
  const buscado = useRef('');

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
    } finally {
      setListo(true);
    }
  }, [toast]);

  const leerTodo = useCallback(async () => {
    setEstado((e) => ({ ...e, sinLeer: 0, avisos: e.avisos.map((a) => ({ ...a, leido: true })) }));
    cerrarNotificaciones((tag) => tag.startsWith('aviso-'));
    await portal('inicio.leerAvisos').catch(() => undefined);
    refrescar();
  }, [refrescar]);

  const abrir = useCallback((a: Aviso) => {
    if (!a.leido) {
      setEstado((e) => ({ ...e, sinLeer: Math.max(0, e.sinLeer - 1), avisos: e.avisos.map((x) => (x.id === a.id ? { ...x, leido: true } : x)) }));
      portal('inicio.leerAviso', { id: a.id }).catch(() => undefined);
    }
    cerrarNotificaciones((tag) => tag === `aviso-${a.id}`);
    const destino = DESTINO[a.tipo ?? ''];
    if (destino && !a.imagen) {
      location.hash = `/${destino.key}`;
      return;
    }
    setAbierto(a);
    if (avisoDeHash()) location.hash = '/inicio';
  }, []);

  useEffect(() => {
    refrescar();
  }, [refrescar]);
  usePoll(refrescar, 30000);

  // Notificación push tocada: #aviso/<id>. Si el aviso acaba de llegar y aún no está en la lista, se vuelve a consultar una vez.
  useEffect(() => {
    const ver = () => {
      const id = avisoDeHash();
      if (!id || !listo) return;
      const a = estado.avisos.find((x) => x.id === id);
      if (a) abrir(a);
      else if (buscado.current !== id) {
        buscado.current = id;
        refrescar();
      } else location.hash = '/inicio';
    };
    ver();
    window.addEventListener('hashchange', ver);
    return () => window.removeEventListener('hashchange', ver);
  }, [listo, estado.avisos, abrir, refrescar]);

  const chatSinLeer = estado.chat.ADMIN + estado.chat.CASETA;
  const total = estado.sinLeer + chatSinLeer;
  useInsigniaApp(total);

  return (
    <AvisosCtx.Provider value={{ ...estado, total, chatSinLeer, refrescar, leerTodo, abrir }}>
      {children}
      {abierto && <AvisoCompleto aviso={abierto} onClose={() => setAbierto(null)} />}
    </AvisosCtx.Provider>
  );
}

/** Aviso completo: imagen en grande (se puede ver en pantalla completa), texto y botón a su sección. */
function AvisoCompleto({ aviso: a, onClose }: { aviso: Aviso; onClose: () => void }) {
  const [grande, setGrande] = useState(false);
  const destino = DESTINO[a.tipo ?? ''];
  return (
    <Modal title="Notificación" onClose={onClose}>
      <div className="aviso-completo">
        <h3>{a.titulo}</h3>
        <div className="list-sub">{fechaHora(a.createdAt)}</div>
        {a.imagen && (
          <button className="aviso-completo-img" onClick={() => setGrande(true)} aria-label="Ver la imagen en pantalla completa">
            <img src={a.imagen} alt="" />
            <span className="small muted">Toca la imagen para verla en pantalla completa</span>
          </button>
        )}
        {a.texto && <p className="pre">{a.texto}</p>}
        <div className="row-actions">
          {destino && (
            <button className="btn-app" onClick={() => (onClose(), (location.hash = `/${destino.key}`))}>
              {destino.label}
              <Icon name="arrow" />
            </button>
          )}
          <button className={`btn-app ${destino ? 'secondary' : ''}`} onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
      {grande && a.imagen && <VerImagen src={a.imagen} alt={a.titulo} onClose={() => setGrande(false)} />}
    </Modal>
  );
}

/** Aviso como renglón tocable (campana e Inicio). */
export function itemDeAviso(a: Aviso, abrir: (a: Aviso) => void): ItemCampana {
  return { id: a.id, icono: ICONO_AVISO[a.tipo ?? ''] ?? 'bell', titulo: a.titulo, texto: a.texto, fecha: a.createdAt, imagen: a.imagen, nuevo: !a.leido, abrir: () => abrir(a) };
}

export function Campana() {
  const { sinLeer, total, chat, avisos, leerTodo, abrir } = useAvisos();
  const items: ItemCampana[] = [
    ...(['ADMIN', 'CASETA'] as const)
      .filter((c) => chat[c] > 0)
      .map((c) => ({
        id: `chat-${c}`,
        icono: 'chat',
        titulo: `${chat[c] === 1 ? '1 mensaje nuevo' : `${chat[c]} mensajes nuevos`} de ${c === 'ADMIN' ? 'la administración' : 'la caseta'}`,
        texto: 'Toca para abrir el chat.',
        nuevo: true,
        abrir: () => (location.hash = `/chat/${c}`),
      })),
    // Solo lo que falta por ver: al abrirlo desaparece
    ...avisos.filter((a) => !a.leido).map((a) => itemDeAviso(a, abrir)),
  ];
  return (
    <CampanaBase
      total={total}
      items={items}
      encabezado={
        sinLeer > 0 && (
          <button className="linklike" onClick={leerTodo}>
            Marcar todo como leído
          </button>
        )
      }
    />
  );
}

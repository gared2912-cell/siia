// Campana de notificaciones común (residentes, caseta y administración): botón con contador y lista
// desplegable. Cada elemento se puede tocar y lleva a donde se atiende (sección o aviso completo).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, fechaHora } from './ui';

export type ItemCampana = {
  id: string;
  icono: string;
  titulo: string;
  texto?: string;
  fecha?: string;
  imagen?: string;
  /** Sin leer o pendiente de atender (fondo resaltado). */
  nuevo?: boolean;
  abrir: () => void;
};

export function Campana({ total, items, encabezado, vacio = 'Sin notificaciones.' }: { total: number; items: ItemCampana[]; encabezado?: ReactNode; vacio?: string }) {
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
            {encabezado}
          </div>
          {items.length ? (
            <ul className="list campana-lista">
              {items.map((i) => (
                <li key={i.id} className={i.nuevo ? 'no-leido' : ''}>
                  <ItemAviso item={i} onAbrir={() => setAbierto(false)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small" style={{ padding: 16, margin: 0 }}>
              {vacio}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Revisado (caseta y administración) ----------
// Sus pendientes se quitan solos cuando se atienden; mientras tanto, lo que ya se revisó deja de contar en la
// campana. Se recuerda en este dispositivo: id → momento en que se revisó. Si el pendiente cambia después
// (p. ej. otro mensaje en el mismo chat, con `fecha` más reciente), vuelve a contar.
const EVENTO = 'siia-vistos';
const leerVistos = (clave: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? '{}');
  } catch {
    return {};
  }
};

/** Marca un pendiente como revisado (también desde fuera de la campana, p. ej. al abrir un chat). */
export function marcarVisto(clave: string, id: string, fecha?: string) {
  const v = leerVistos(clave);
  const ahora = new Date().toISOString();
  v[id] = fecha && fecha > ahora ? fecha : ahora;
  // Solo se conservan los 300 más recientes
  const recientes = Object.entries(v).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 300);
  try {
    localStorage.setItem(clave, JSON.stringify(Object.fromEntries(recientes)));
  } catch {
    /* sin almacenamiento local: solo dura esta sesión */
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { clave, id, en: v[id] } }));
}

/** Aplica lo revisado a los renglones: tocar uno lo marca y solo los no revisados quedan como nuevos. */
export function useVistos(clave: string) {
  const [vistos, setVistos] = useState(() => leerVistos(clave));
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ clave: string; id: string; en: string }>).detail;
      if (d.clave === clave) setVistos((prev) => ({ ...prev, [d.id]: d.en }));
    };
    window.addEventListener(EVENTO, on);
    return () => window.removeEventListener(EVENTO, on);
  }, [clave]);
  return useCallback(
    (items: ItemCampana[]): ItemCampana[] =>
      items.map((i) => {
        const visto = vistos[i.id];
        const revisado = !!visto && (!i.fecha || visto >= i.fecha);
        return { ...i, nuevo: i.nuevo && !revisado, abrir: () => (marcarVisto(clave, i.id, i.fecha), i.abrir()) };
      }),
    [vistos, clave],
  );
}

/** Renglón tocable de una notificación (campana y lista de avisos del Inicio). */
export function ItemAviso({ item: i, onAbrir }: { item: ItemCampana; onAbrir?: () => void }) {
  return (
    <button className="aviso-item" onClick={() => (onAbrir?.(), i.abrir())}>
      <span className="tile-icon" style={{ width: 32, height: 32 }}>
        <Icon name={i.icono} />
      </span>
      <span className="list-main">
        <strong>{i.titulo}</strong>
        {i.imagen && <img className="aviso-imagen" src={i.imagen} alt="" loading="lazy" />}
        {i.texto && <span className="small aviso-texto">{i.texto}</span>}
        {i.fecha && <span className="list-sub">{fechaHora(i.fecha)}</span>}
      </span>
      <Icon name="arrow" className="aviso-ir" />
    </button>
  );
}

// Componentes y utilidades compartidos por el portal, la caseta y el panel de administración.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { urlArchivo } from './api';

// ---------- Formato ----------
const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
export const money = (n?: number | null) => mxn.format(n ?? 0);

export function fecha(d?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return date.toLocaleDateString('es-MX', opts);
}
export function fechaHora(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function hoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}
export function periodoActual() {
  return hoy().slice(0, 7);
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- Iconos (mismo trazo que el sitio) ----------
const P: Record<string, string> = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  vote: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.8 1.2 3.5 3.5 0 0 0-2.4-2.4A3.5 3.5 0 0 1 6 10.4 5 5 0 0 1 9 10z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  package: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
};
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      className={className ? `ico ${className}` : 'ico'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: P[name] ?? P.check }}
    />
  );
}

// ---------- Estados ----------
const TONO: Record<string, string> = {
  APROBADO: 'ok', APROBADA: 'ok', VALIDADO: 'ok', PAGADO: 'ok', RESUELTO: 'ok', TERMINADO: 'ok', DENTRO: 'ok', ABIERTA: 'ok',
  PENDIENTE: 'warn', EN_REVISION: 'warn', SOLICITADA: 'warn', ABIERTO: 'warn', EN_PROCESO: 'info', PROGRAMADO: 'info', PROGRAMADA: 'info',
  RECHAZADO: 'bad', RECHAZADA: 'bad', SUSPENDIDO: 'bad', CANCELADO: '', CANCELADA: '', CERRADO: '', CERRADA: '', SALIO: '',
  VENCIDO: 'bad',
};
const TEXTO: Record<string, string> = {
  EN_REVISION: 'En revisión', EN_PROCESO: 'En proceso', SALIO: 'Salió', PAQUETERIA: 'Paquetería',
};
export const etiquetaEstado = (e?: string | null) =>
  e ? TEXTO[e] ?? e.charAt(0) + e.slice(1).toLowerCase() : '—';
export function Badge({ estado, children }: { estado?: string | null; children?: ReactNode }) {
  return <span className={`badge ${TONO[estado ?? ''] ?? ''}`}>{children ?? etiquetaEstado(estado)}</span>;
}

// ---------- Carga de datos ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

/** Repite `fn` cada `ms` mientras la pestaña está visible. */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => document.visibilityState === 'visible' && ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; error?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((msg: string, error?: boolean) => {
    setT({ msg, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className={`toast ${t.error ? 'error' : ''}`} role="status" aria-live="polite">
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/** Ejecuta una acción mostrando el resultado en un toast; regresa true si tuvo éxito. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMsg?: string) => {
      setBusy(true);
      try {
        await fn();
        if (okMsg) toast(okMsg);
        return true;
      } catch (e) {
        toast(errMsg(e), true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---------- Piezas de UI ----------
export const Loading = () => (
  <div className="loading" aria-label="Cargando">
    <div className="spinner" />
  </div>
);

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="alert error">
      {error}{' '}
      {retry && (
        <button className="linklike" onClick={retry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function Empty({ icon = 'inbox', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function PageHead({ title, sub, icon, children }: { title: string; sub?: ReactNode; icon?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-title">
        {icon && (
          <span className="page-icon" aria-hidden="true">
            <Icon name={icon} />
          </span>
        )}
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      {children && <div className="row-actions">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="fld">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Miniatura/enlace de un archivo privado de S3. */
export function Archivo({ path, label = 'Ver archivo', thumb }: { path?: string | null; label?: string; thumb?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (path) urlArchivo(path).then((u) => vivo && setUrl(u)).catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [path]);
  if (!path) return null;
  const esImagen = /\.(png|jpe?g|webp|gif|heic)$/i.test(path);
  if (thumb && esImagen) return url ? <img className="photo-thumb" src={url} alt="" /> : <span className="photo-thumb" />;
  return url ? (
    <a href={url} target="_blank" rel="noopener" className="small">
      {label}
    </a>
  ) : (
    <span className="small muted">{label}…</span>
  );
}

export const MODULOS: { key: string; label: string; icon: string; desc: string }[] = [
  { key: 'finanzas', label: 'Finanzas y recibos', icon: 'money', desc: 'Estado de cuenta, pagos y recibos' },
  { key: 'visitas', label: 'Visitas y caseta', icon: 'qr', desc: 'Pases QR, bitácora y alertas de caseta' },
  { key: 'comunicados', label: 'Comunicados', icon: 'megaphone', desc: 'Avisos de la administración' },
  { key: 'encuestas', label: 'Encuestas', icon: 'vote', desc: 'Votaciones electrónicas' },
  { key: 'chat', label: 'Chat', icon: 'chat', desc: 'Con administración y caseta' },
  { key: 'incidentes', label: 'Incidentes', icon: 'alert', desc: 'Reporte y seguimiento de fallas' },
  { key: 'mantenimientos', label: 'Mantenimientos', icon: 'tools', desc: 'Calendario de mantenimientos' },
  { key: 'amenidades', label: 'Amenidades', icon: 'calendar', desc: 'Reservas de áreas comunes' },
  { key: 'mascotas', label: 'Mascota segura', icon: 'paw', desc: 'Registro y reporte de mascotas' },
];

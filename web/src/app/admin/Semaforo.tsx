// Semáforo de pendientes del panel, junto a la campana. Suma todo lo que falta por atender (comprobantes, chats,
// reservas, mascotas, incidentes, solicitudes de acceso, cotizaciones y asistencia técnica):
//   hasta 5 → verde · más de 5 → amarillo · más de 10 → rojo.
// Lo acompaña el beagle de SIIA: baila de gusto en verde, se pone triste en amarillo y se enoja en rojo. En el celular
// solo se muestra el semáforo. Cada 30 minutos, si no está en verde, el beagle recuerda en tono amable cuántos hay.
// Al tocarlo se ve cuántos pendientes tiene cada módulo y se puede ir directo.
// Sonidos (los configura el superadministrador por condominio): en amarillo ladra y en rojo gruñe, cada 2 horas por
// omisión; en verde no hace nada. El último sonido se recuerda en el navegador para no repetirlo al recargar.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui';
import { configBeagle } from '../../../amplify/functions/shared/beagle';
import { sonar } from './sonidosBeagle';

export type Luz = 'verde' | 'amarillo' | 'rojo';
export const luzDe = (total: number): Luz => (total > 10 ? 'rojo' : total > 5 ? 'amarillo' : 'verde');

const RECORDATORIO = 'siia-beagle-recordatorio';
const CADA = 30 * 60_000;

function mensaje(luz: Luz, total: number) {
  if (luz === 'verde') return total ? `¡Guau, vas muy bien! Solo ${total === 1 ? 'queda 1 pendiente' : `quedan ${total} pendientes`}.` : '¡Todo al día! Me voy a mover la cola 🐾';
  if (luz === 'amarillo') return `Auuu… se juntaron ${total} pendientes. ¿Les damos una vuelta juntos?`;
  return `¡Grrr! Ya son ${total} pendientes esperando. ¡Hay que atenderlos ya!`;
}

/** Beagle caricatura en SVG con tres estados de ánimo (feliz, triste, enojado). */
export function Beagle({ luz, size = 44 }: { luz: Luz; size?: number }) {
  const animo = luz === 'verde' ? 'feliz' : luz === 'amarillo' ? 'triste' : 'enojado';
  return (
    <svg className={`beagle b-${animo}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {animo === 'feliz' && (
        <g className="beagle-notas" fill="#0d7c74">
          <text x="2" y="12" fontSize="10">♪</text>
          <text x="53" y="9" fontSize="9">♫</text>
        </g>
      )}
      {animo === 'enojado' && (
        <g className="beagle-vapor" fill="#9ca3af">
          <circle cx="14" cy="9" r="3" />
          <circle cx="10" cy="5" r="2.2" />
          <circle cx="50" cy="9" r="3" />
          <circle cx="54" cy="5" r="2.2" />
        </g>
      )}
      <g className="beagle-cuerpo">
        {/* Orejas largas y caídas */}
        <path className="oreja oreja-izq" d="M17 17 C6 18 4 36 9 45 C12 51 19 49 20 42 L22 22 Z" fill="#6b3f1f" />
        <path className="oreja oreja-der" d="M47 17 C58 18 60 36 55 45 C52 51 45 49 44 42 L42 22 Z" fill="#6b3f1f" />
        {/* Cabeza café con la franja blanca y el hocico blanco */}
        <ellipse cx="32" cy="31" rx="16" ry="17" fill="#c98a4b" />
        {animo === 'enojado' && <ellipse className="beagle-rubor" cx="32" cy="31" rx="16" ry="17" fill="#ef4444" opacity="0.32" />}
        <path d="M29.5 14.5 C30.5 21 28.5 27 26.5 33 L37.5 33 C35.5 27 33.5 21 34.5 14.5 Z" fill="#fff6ec" />
        <ellipse cx="32" cy="40" rx="11.5" ry="8.5" fill="#fff6ec" />
        <ellipse cx="32" cy="35.4" rx="3.8" ry="2.7" fill="#2b1d14" />
        <ellipse cx="31" cy="34.6" rx="1.1" ry="0.6" fill="#fff" opacity="0.7" />
        {animo === 'feliz' && (
          <>
            <path d="M21.5 28.5 q3 -3.6 6 0" stroke="#2b1d14" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M36.5 28.5 q3 -3.6 6 0" stroke="#2b1d14" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="20" cy="34" r="2.3" fill="#f6a5a5" opacity="0.8" />
            <circle cx="44" cy="34" r="2.3" fill="#f6a5a5" opacity="0.8" />
            <path d="M26.5 40.5 q5.5 7 11 0 z" fill="#7a2e2e" />
            <path className="beagle-lengua" d="M29.7 43.2 q2.3 5.2 4.6 0 z" fill="#f28b9b" />
          </>
        )}
        {animo === 'triste' && (
          <>
            <path d="M20.5 24.5 L27 22.5" stroke="#2b1d14" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M37 22.5 L43.5 24.5" stroke="#2b1d14" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="24.5" cy="28.5" r="2.4" fill="#2b1d14" />
            <circle cx="39.5" cy="28.5" r="2.4" fill="#2b1d14" />
            <circle cx="25.3" cy="27.7" r="0.8" fill="#fff" />
            <circle cx="40.3" cy="27.7" r="0.8" fill="#fff" />
            <path d="M27.5 45 q4.5 -4.5 9 0" stroke="#2b1d14" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            <path className="beagle-lagrima" d="M22.5 31.5 q-1.8 3 0 4.4 q1.8 -1.4 0 -4.4 z" fill="#60a5fa" />
          </>
        )}
        {animo === 'enojado' && (
          <>
            <path d="M19.5 22 L27.5 25.5" stroke="#2b1d14" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M36.5 25.5 L44.5 22" stroke="#2b1d14" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M21.5 28 q3 2.6 6 0 z" fill="#2b1d14" />
            <path d="M36.5 28 q3 2.6 6 0 z" fill="#2b1d14" />
            <rect x="26.5" y="40.5" width="11" height="5" rx="1.6" fill="#fff" stroke="#2b1d14" strokeWidth="1.2" />
            <path d="M26.5 43 h11 M30.2 40.5 v5 M33.8 40.5 v5" stroke="#2b1d14" strokeWidth="0.8" />
          </>
        )}
      </g>
    </svg>
  );
}

const SECCION: Record<string, { label: string; icono: string }> = {
  finanzas: { label: 'Comprobantes por aprobar', icono: 'money' },
  chat: { label: 'Mensajes por responder', icono: 'chat' },
  amenidades: { label: 'Reservas por aprobar', icono: 'calendar' },
  mascotas: { label: 'Mascotas por validar', icono: 'paw' },
  incidentes: { label: 'Incidentes nuevos', icono: 'alert' },
  condominios: { label: 'Solicitudes de acceso', icono: 'users' },
  cotizaciones: { label: 'Cotizaciones del sitio web', icono: 'inbox' },
  asistencia: { label: 'Asistencia técnica', icono: 'help' },
};

export function Semaforo({
  total,
  conteos,
  go,
  condoId,
  sonidos,
}: {
  total: number;
  conteos: Record<string, number>;
  go: (k: string) => void;
  condoId?: string;
  sonidos?: unknown;
}) {
  const luz = luzDe(total);
  const [abierto, setAbierto] = useState(false);
  const [globo, setGlobo] = useState(false);
  const [suena, setSuena] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cfg = configBeagle(sonidos);

  // Sonido: amarillo → ladrido, rojo → gruñido, cada cfg.cadaMin minutos. Si el navegador aún no deja reproducir
  // audio (no se ha tocado la página), suena al primer toque.
  useEffect(() => {
    if (!cfg.activo || luz === 'verde' || !condoId) return;
    const clave = `siia-beagle-sonido-${condoId}`;
    let vivo = true;
    let esperando = false;
    const alTocar = () => {
      esperando = false;
      intentar();
    };
    async function intentar() {
      let ultimo = 0;
      try {
        ultimo = Number(localStorage.getItem(clave)) || 0;
      } catch {
        /* sin almacenamiento local */
      }
      if (!vivo || Date.now() - ultimo < cfg.cadaMin * 60_000) return;
      const ok = await sonar(luz === 'rojo' ? 'grunido' : 'ladrido', cfg.volumen);
      if (!vivo) return;
      if (!ok) {
        if (!esperando) {
          esperando = true;
          document.addEventListener('pointerdown', alTocar, { once: true });
        }
        return;
      }
      try {
        localStorage.setItem(clave, String(Date.now()));
      } catch {
        /* sin almacenamiento local */
      }
      setSuena(true);
      setTimeout(() => vivo && setSuena(false), 1600);
    }
    intentar();
    const t = setInterval(intentar, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener('pointerdown', alTocar);
    };
  }, [luz, condoId, cfg.activo, cfg.cadaMin, cfg.volumen]);

  // Recordatorio amable: si no está en verde, el beagle habla al entrar y luego cada 30 minutos.
  useEffect(() => {
    if (luz === 'verde') {
      setGlobo(false);
      return;
    }
    const revisar = () => {
      let ultimo = 0;
      try {
        ultimo = Number(localStorage.getItem(RECORDATORIO)) || 0;
      } catch {
        /* sin almacenamiento local */
      }
      if (Date.now() - ultimo < CADA) return;
      try {
        localStorage.setItem(RECORDATORIO, String(Date.now()));
      } catch {
        /* sin almacenamiento local */
      }
      setGlobo(true);
    };
    revisar();
    const t = setInterval(revisar, 60_000);
    return () => clearInterval(t);
  }, [luz]);
  useEffect(() => {
    if (!globo) return;
    const t = setTimeout(() => setGlobo(false), 12_000);
    return () => clearTimeout(t);
  }, [globo]);
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

  const lista = Object.entries(conteos).filter(([k, n]) => n > 0 && SECCION[k]);
  const texto = luz === 'verde' ? 'En verde' : luz === 'amarillo' ? 'En amarillo' : 'En rojo';
  return (
    <div className={`semaforo-wrap luz-${luz}${suena ? (luz === 'rojo' ? ' grune' : ' ladra') : ''}`} ref={ref}>
      <button
        className="semaforo-btn"
        onClick={() => (setAbierto(!abierto), setGlobo(false))}
        aria-expanded={abierto}
        aria-label={`Semáforo de pendientes: ${texto}, ${total} pendiente${total === 1 ? '' : 's'}`}
        title={`${total} pendiente${total === 1 ? '' : 's'}`}
      >
        <span className="semaforo" aria-hidden="true">
          <span className={`foco rojo ${luz === 'rojo' ? 'on' : ''}`} />
          <span className={`foco amarillo ${luz === 'amarillo' ? 'on' : ''}`} />
          <span className={`foco verde ${luz === 'verde' ? 'on' : ''}`} />
        </span>
        <span className="semaforo-beagle">
          <Beagle luz={luz} />
        </span>
      </button>
      {globo && !abierto && (
        <button className="beagle-globo" onClick={() => (setGlobo(false), setAbierto(true))}>
          {mensaje(luz, total)}
        </button>
      )}
      {abierto && (
        <div className="semaforo-panel" role="dialog" aria-label="Pendientes por módulo">
          <div className="semaforo-panel-cab">
            <Beagle luz={luz} size={56} />
            <p>{mensaje(luz, total)}</p>
          </div>
          {lista.length ? (
            <ul className="list">
              {lista.map(([k, n]) => (
                <li key={k}>
                  <button className="aviso-item" onClick={() => (setAbierto(false), go(k === 'condominios' ? 'condominios/residentes' : k === 'finanzas' ? 'finanzas/revision' : k))}>
                    <span className="tile-icon" style={{ width: 32, height: 32 }}>
                      <Icon name={SECCION[k].icono} />
                    </span>
                    <span className="list-main">
                      <strong>{SECCION[k].label}</strong>
                    </span>
                    <span className="nav-count" style={{ marginLeft: 0 }}>
                      {n}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ padding: '0 16px 16px', margin: 0 }}>
              Nada pendiente por ahora.
            </p>
          )}
          <p className="small muted semaforo-leyenda">Hasta 5 pendientes: verde · más de 5: amarillo · más de 10: rojo</p>
        </div>
      )}
    </div>
  );
}

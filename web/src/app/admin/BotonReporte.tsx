// Botón flotante del panel: el administrador reporta una falla o solicita una mejora, con su comentario e imágenes
// (capturas o fotos). Lo recibe el desarrollador; aquí mismo se ven «Mis reportes» con su estado y la respuesta.
// No se muestra en la cuenta del desarrollador (shared/reportes.ts).
import { useEffect, useState } from 'react';
import { adminCall } from '../api';
import { ElegirArchivo } from '../ElegirArchivo';
import { Badge, Empty, Field, Icon, Loading, Modal, Tarjeta, TarjetaIcono, Tarjetas, VerImagen, fecha, useAction, useLoad, type Tono } from '../ui';
import { useAdmin } from './AdminApp';
import { ESTADOS_REPORTE, MAX_IMAGENES_REPORTE, MIN_TEXTO_REPORTE, TIPOS_REPORTE, avisoResuelto, type EstadoReporte, type TipoReporte } from '../../../amplify/functions/shared/reportes';

export type ReporteVista = {
  id: string;
  tipo: TipoReporte;
  estado: EstadoReporte;
  texto: string;
  pagina?: string | null;
  condominioNombre?: string | null;
  porNombre?: string | null;
  porEmail?: string | null;
  porRol?: string | null;
  navegador?: string | null;
  respuesta?: string | null;
  atendidoEn?: string | null;
  createdAt: string;
  imagenUrls: string[];
};

/** Color de la tarjeta y del estado según cómo va el reporte. */
export const tonoReporte = (e: string): Tono => (e === 'RESUELTO' ? 'ok' : e === 'DESCARTADO' ? 'neutro' : e === 'EN_REVISION' ? 'info' : 'warn');
export const estadoBadge = (e: string) => (e === 'RESUELTO' ? 'APROBADO' : e === 'DESCARTADO' ? 'CANCELADA' : e === 'EN_REVISION' ? 'EN_REVISION' : 'PENDIENTE');

/** La campana abre «Mis reportes» con este evento (el botón flotante tiene la ventana). */
export const EVENTO_MIS_REPORTES = 'siia:mis-reportes';

export function BotonReporte({ seccion }: { seccion: string }) {
  const [abierto, setAbierto] = useState<false | 'inicio' | 'mios'>(false);
  useEffect(() => {
    const abrir = () => setAbierto('mios');
    window.addEventListener(EVENTO_MIS_REPORTES, abrir);
    return () => window.removeEventListener(EVENTO_MIS_REPORTES, abrir);
  }, []);
  return (
    <>
      <button type="button" className="fab-reporte" onClick={() => setAbierto('inicio')} aria-label="Reportar una falla o solicitar una mejora" title="Reportar una falla o solicitar una mejora">
        <Icon name="alert" />
        <span>Reportar o sugerir</span>
      </button>
      {abierto && <VentanaReporte seccion={seccion} mios={abierto === 'mios'} onClose={() => setAbierto(false)} />}
    </>
  );
}

function VentanaReporte({ seccion, mios: alAbrir, onClose }: { seccion: string; mios?: boolean; onClose: () => void }) {
  const [tipo, setTipo] = useState<TipoReporte | null>(null);
  const [mios, setMios] = useState(!!alAbrir);
  if (mios) return <MisReportes onBack={() => setMios(false)} onClose={onClose} />;
  if (tipo) return <FormReporte tipo={tipo} seccion={seccion} onBack={() => setTipo(null)} onClose={onClose} />;
  return (
    <Modal title="¿Qué quieres hacer?" onClose={onClose}>
      <div className="stack">
        <div className="tipos-reporte">
          <button type="button" className="tipo-reporte" onClick={() => setTipo('FALLA')}>
            <TarjetaIcono name="alert" />
            <span>
              <strong>{TIPOS_REPORTE.FALLA.label}</strong>
              <span className="small muted">Algo no funciona, marca un error o se ve mal.</span>
            </span>
          </button>
          <button type="button" className="tipo-reporte" onClick={() => setTipo('MEJORA')}>
            <TarjetaIcono name="bulb" />
            <span>
              <strong>{TIPOS_REPORTE.MEJORA.label}</strong>
              <span className="small muted">Una idea o algo que te gustaría que el sistema hiciera.</span>
            </span>
          </button>
        </div>
        <button type="button" className="linklike" style={{ alignSelf: 'flex-start' }} onClick={() => setMios(true)}>
          Ver mis reportes y su estado
        </button>
      </div>
    </Modal>
  );
}

function FormReporte({ tipo, seccion, onBack, onClose }: { tipo: TipoReporte; seccion: string; onBack: () => void; onClose: () => void }) {
  const { condo } = useAdmin();
  const [texto, setTexto] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [vistas, setVistas] = useState<string[]>([]);
  const { run, busy } = useAction();
  const lleno = fotos.length >= MAX_IMAGENES_REPORTE;

  useEffect(() => {
    const urls = fotos.map((f) => URL.createObjectURL(f));
    setVistas(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [fotos]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      if (texto.trim().length < MIN_TEXTO_REPORTE) throw new Error('Describe con un poco más de detalle (mínimo 10 caracteres).');
      const imagenes: string[] = [];
      for (const f of fotos) {
        const nombre = /\.[a-z0-9]+$/i.test(f.name) ? f.name : 'captura.jpg';
        const r = await adminCall<{ url: string; path: string; contentType: string }>('reportes.subirImagen', { nombre, tamano: f.size });
        const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: f });
        if (!put.ok) throw new Error('No se pudo subir una imagen. Intenta de nuevo.');
        imagenes.push(r.path);
      }
      await adminCall('reportes.crear', { tipo, texto: texto.trim(), imagenes, pagina: seccion, condominioId: condo?.id, navegador: navigator.userAgent });
    }, tipo === 'FALLA' ? 'Gracias: tu reporte llegó al equipo de SIIA' : 'Gracias: tu solicitud llegó al equipo de SIIA');
    if (okk) onClose();
  }

  return (
    <Modal title={TIPOS_REPORTE[tipo].label} onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <Field
          label={tipo === 'FALLA' ? '¿Qué pasó?' : '¿Qué te gustaría mejorar?'}
          hint={tipo === 'FALLA' ? 'Qué estabas haciendo, qué esperabas y qué pasó (si salió un mensaje, cópialo).' : 'Cuéntanos la idea y para qué te ayudaría.'}
        >
          <textarea required rows={5} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
        </Field>
        <Field grupo label={`Imágenes (opcional, máximo ${MAX_IMAGENES_REPORTE})`} hint="Capturas de pantalla o fotos que ayuden a entenderlo.">
          <ElegirArchivo multiple disabled={lleno} onChange={(fs) => setFotos([...fotos, ...fs].slice(0, MAX_IMAGENES_REPORTE))} />
        </Field>
        {vistas.length > 0 && (
          <div className="miniaturas">
            {vistas.map((v, k) => (
              <figure key={v}>
                <img src={v} alt={`Imagen ${k + 1}`} />
                <button type="button" className="quitar" aria-label={`Quitar imagen ${k + 1}`} onClick={() => setFotos(fotos.filter((_, i) => i !== k))}>
                  <Icon name="x" />
                </button>
              </figure>
            ))}
          </div>
        )}
        <div className="row-actions">
          <button type="button" className="btn-app secondary" onClick={onBack} disabled={busy}>
            <Icon name="chevron-left" />
            Volver
          </button>
          <button className="btn-app" disabled={busy}>
            <Icon name="check" />
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MisReportes({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { data, loading, error } = useLoad(() => adminCall<ReporteVista[]>('reportes.mios'));
  const [ver, setVer] = useState<ReporteVista | null>(null);
  if (ver) return <DetalleReporte r={ver} onBack={() => setVer(null)} onClose={onClose} />;
  return (
    <Modal title="Mis reportes" onClose={onClose}>
      <div className="stack">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <p className="small">{error}</p>
        ) : data?.length ? (
          <Tarjetas>
            {data.map((r) => (
              <Tarjeta
                key={r.id}
                tono={tonoReporte(r.estado)}
                onClick={() => setVer(r)}
                media={<TarjetaIcono name={r.tipo === 'FALLA' ? 'alert' : 'bulb'} />}
                titulo={r.texto.length > 70 ? `${r.texto.slice(0, 70)}…` : r.texto}
                sub={`${TIPOS_REPORTE[r.tipo]?.corto ?? ''} · ${fecha(r.createdAt)}${r.respuesta ? ' · Con respuesta' : ''}`}
                lado={<Badge estado={estadoBadge(r.estado)}>{ESTADOS_REPORTE[r.estado]}</Badge>}
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="flag">Aún no has enviado reportes ni solicitudes.</Empty>
        )}
        <button type="button" className="btn-app secondary" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
          <Icon name="chevron-left" />
          Volver
        </button>
      </div>
    </Modal>
  );
}

/** Detalle de un reporte: texto, imágenes, estado y respuesta del equipo de SIIA. */
export function DetalleReporte({ r, onBack, onClose, children }: { r: ReporteVista; onBack?: () => void; onClose: () => void; children?: React.ReactNode }) {
  const [imagen, setImagen] = useState<string | null>(null);
  return (
    <Modal title={r.tipo === 'MEJORA' ? 'Solicitud de mejora' : 'Reporte de falla'} onClose={onClose}>
      <div className="stack">
        <div className="row-actions">
          <Badge estado={estadoBadge(r.estado)}>{ESTADOS_REPORTE[r.estado]}</Badge>
          <span className="small muted">Enviado el {fecha(r.createdAt)}</span>
        </div>
        {r.estado === 'RESUELTO' && (
          <div className="alert ok small" style={{ margin: 0 }}>
            <Icon name="check" /> {avisoResuelto(r.tipo)}.
          </div>
        )}
        <p className="pre" style={{ margin: 0 }}>
          {r.texto}
        </p>
        {r.imagenUrls.length > 0 && (
          <div className="miniaturas">
            {r.imagenUrls.map((u, k) => (
              <figure key={u}>
                <button type="button" className="ver" onClick={() => setImagen(u)} aria-label={`Ver imagen ${k + 1}`}>
                  <img src={u} alt={`Imagen ${k + 1}`} />
                </button>
              </figure>
            ))}
          </div>
        )}
        {r.respuesta && (
          <div className="alert small" style={{ margin: 0 }}>
            <strong>Respuesta del equipo de SIIA{r.atendidoEn ? ` (${fecha(r.atendidoEn)})` : ''}:</strong>
            <p className="pre" style={{ margin: '4px 0 0' }}>
              {r.respuesta}
            </p>
          </div>
        )}
        {children}
        {onBack && (
          <button type="button" className="btn-app secondary" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
            <Icon name="chevron-left" />
            Volver
          </button>
        )}
      </div>
      {imagen && <VerImagen src={imagen} onClose={() => setImagen(null)} />}
    </Modal>
  );
}

// Cámara del dispositivo (escáner QR de la caseta y fotos del chat). La app es una página web instalada, así que
// el permiso lo da el navegador o el sistema: se pide con getUserMedia la primera vez y luego se recuerda.
// Aquí: estado del permiso, pedirlo, mensajes claros cuando falla y la sección de «App y notificaciones».
import { useEffect, useState } from 'react';
import { Icon, useToast } from './ui';

export type EstadoCamara = 'granted' | 'denied' | 'prompt' | 'unsupported';

const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Estado del permiso (en Safari antiguo no se puede consultar: se toma como «preguntar»). */
export async function estadoCamara(): Promise<EstadoCamara> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const p = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return p.state as EstadoCamara;
  } catch {
    return 'prompt';
  }
}

/** Cómo activar la cámara si quedó bloqueada, según el dispositivo. */
export function comoActivarCamara() {
  if (esIOS())
    return 'En iPhone: abre Ajustes › Safari › Cámara y elige «Permitir» (o «Preguntar»). Si usas la app SIIA instalada, ciérrala por completo y vuelve a abrirla.';
  return 'En Android: mantén presionado el ícono de SIIA › Información de la app › Permisos › Cámara › Permitir. En el navegador: toca el candado junto a la dirección › Permisos › Cámara › Permitir.';
}

/** Mensaje entendible para cada error de getUserMedia. */
export function mensajeErrorCamara(e: unknown) {
  const n = (e as { name?: string })?.name ?? '';
  if (!window.isSecureContext) return 'La cámara solo funciona en una conexión segura (https).';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError')
    return `SIIA no tiene permiso para usar la cámara. ${comoActivarCamara()}`;
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'No encontramos una cámara en este dispositivo.';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError')
    return 'La cámara está ocupada por otra app (por ejemplo, una videollamada). Ciérrala e intenta de nuevo.';
  if (!navigator.mediaDevices?.getUserMedia) return 'Este navegador no permite usar la cámara. Usa Chrome en Android o Safari en iPhone.';
  return `No se pudo abrir la cámara${e instanceof Error && e.message ? `: ${e.message}` : ''}.`;
}

/** Pide el permiso abriendo la cámara un instante (el sistema muestra su aviso de «Permitir»). */
export async function pedirCamara() {
  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  s.getTracks().forEach((t) => t.stop());
}

/** Sección «Cámara» de App y notificaciones. */
export function PermisoCamara() {
  const [estado, setEstado] = useState<EstadoCamara | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    estadoCamara().then(setEstado);
  }, []);
  const permitir = async () => {
    setBusy(true);
    try {
      await pedirCamara();
      setEstado('granted');
      toast('Cámara permitida en este dispositivo');
    } catch (e) {
      setEstado(await estadoCamara());
      toast(mensajeErrorCamara(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="app-paso">
      <h3>
        <Icon name="camera" /> Cámara
      </h3>
      {estado === null ? null : estado === 'unsupported' ? (
        <p className="small muted">Este navegador no permite usar la cámara. Usa Chrome en Android o Safari en iPhone.</p>
      ) : estado === 'granted' ? (
        <p className="small">
          <Icon name="check" /> Permitida: puedes escanear pases QR y enviar fotos en el chat.
        </p>
      ) : estado === 'denied' ? (
        <>
          <p className="small muted">La cámara está bloqueada para SIIA. {comoActivarCamara()}</p>
          <button className="btn-app sm secondary" disabled={busy} onClick={permitir}>
            Volver a intentar
          </button>
        </>
      ) : (
        <>
          <p className="small muted">Para escanear pases QR y tomar fotos en el chat. Tu teléfono te pedirá confirmar.</p>
          <button className="btn-app" disabled={busy} onClick={permitir}>
            <Icon name="camera" />
            {busy ? 'Solicitando…' : 'Permitir cámara'}
          </button>
        </>
      )}
    </section>
  );
}

/** Reduce una foto antes de subirla (máx. 1600 px, JPEG): una foto de celular pasa de 4–8 MB a ~300 KB. */
export async function comprimirImagen(file: File, max = 1600): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // formato que el navegador no decodifica (p. ej. HEIC en computadora): se sube tal cual
  }
}

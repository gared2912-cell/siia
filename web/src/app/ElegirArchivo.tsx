// Adjuntar evidencia o fotos: «Tomar foto» abre la cámara y «Subir…» elige un archivo del teléfono o la computadora.
// Las fotos se reducen antes de subirlas (camara.tsx); los PDF se suben tal cual.
import { useEffect, useRef, useState } from 'react';
import { comprimirImagen } from './camara';
import { Icon } from './ui';

export const ACEPTA_IMAGEN = 'image/*';
export const ACEPTA_IMAGEN_PDF = 'image/*,application/pdf';

export function ElegirArchivo({
  pdf,
  multiple,
  disabled,
  value,
  onChange,
}: {
  /** También acepta PDF (si no, solo imágenes). */
  pdf?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  /** Archivo elegido (un solo archivo): se muestra con vista previa y botón para quitarlo. */
  value?: File | null;
  onChange: (files: File[]) => void;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const [vista, setVista] = useState('');

  useEffect(() => {
    const url = value && value.type.startsWith('image/') ? URL.createObjectURL(value) : '';
    setVista(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [value]);

  const elegir = async (lista: FileList | null) => {
    if (!lista?.length) return;
    onChange(await Promise.all([...lista].map((f) => comprimirImagen(f))));
  };

  return (
    <div className="elegir-archivo">
      <div className="row-actions">
        <button type="button" className="btn-app sm secondary" disabled={disabled} onClick={() => camara.current?.click()}>
          <Icon name="camera" />
          Tomar foto
        </button>
        <button type="button" className="btn-app sm secondary" disabled={disabled} onClick={() => archivo.current?.click()}>
          <Icon name="upload" />
          {pdf ? 'Subir foto o PDF' : 'Subir foto'}
        </button>
      </div>
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (elegir(e.target.files), (e.target.value = ''))} />
      <input
        ref={archivo}
        type="file"
        accept={pdf ? ACEPTA_IMAGEN_PDF : ACEPTA_IMAGEN}
        multiple={multiple}
        hidden
        onChange={(e) => (elegir(e.target.files), (e.target.value = ''))}
      />
      {value && (
        <div className="elegido">
          {vista ? <img src={vista} alt="Vista previa" /> : <Icon name="file" />}
          <span className="small">
            {value.name}
            <span className="muted"> · {Math.max(1, Math.round(value.size / 1024))} KB</span>
          </span>
          <button type="button" className="linklike" style={{ color: 'var(--danger)' }} onClick={() => onChange([])}>
            Quitar
          </button>
        </div>
      )}
    </div>
  );
}

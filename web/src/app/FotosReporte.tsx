// Reportes de proveedores (bitácora, panel y Mantenimientos del portal): tarjeta compacta con la primera foto en
// pequeño y la descripción; al tocarla se abre el reporte completo, una foto tras otra con su propia descripción.
import { useState, type ReactNode } from 'react';
import { Icon, Modal, VerImagen } from './ui';

type Foto = { url?: string; descripcion?: string };

export function TarjetaReporteFotos({
  titulo,
  detalle,
  etiqueta,
  descripcion,
  fotos,
}: {
  titulo: string;
  /** Fecha, condominio, proveedor… */
  detalle: string;
  /** Distintivo a la derecha (p. ej. «Para administración») */
  etiqueta?: ReactNode;
  descripcion?: string | null;
  fotos: Foto[];
}) {
  const [abierto, setAbierto] = useState(false);
  const portada = fotos.find((f) => f.url)?.url;
  return (
    <>
      <button type="button" className="panel reporte-tarjeta" onClick={() => setAbierto(true)}>
        <span className="reporte-portada">
          {portada ? <img src={portada} alt="" loading="lazy" /> : <Icon name="camera" />}
          {fotos.length > 1 && <span className="reporte-cuenta">{fotos.length} fotos</span>}
        </span>
        <span className="reporte-txt">
          <span className="reporte-cab">
            <strong>{titulo}</strong>
            {etiqueta}
          </span>
          <span className="list-sub">{detalle}</span>
          {descripcion && <span className="reporte-resumen">{descripcion}</span>}
          <span className="reporte-ver">
            Ver reporte completo{fotos.length ? ` (${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'})` : ''}
            <Icon name="arrow" />
          </span>
        </span>
      </button>
      {abierto && <ReporteCompleto titulo={titulo} detalle={detalle} etiqueta={etiqueta} descripcion={descripcion} fotos={fotos} onClose={() => setAbierto(false)} />}
    </>
  );
}

function ReporteCompleto({
  titulo,
  detalle,
  etiqueta,
  descripcion,
  fotos,
  onClose,
}: {
  titulo: string;
  detalle: string;
  etiqueta?: ReactNode;
  descripcion?: string | null;
  fotos: Foto[];
  onClose: () => void;
}) {
  const [ver, setVer] = useState<string | null>(null);
  return (
    <Modal title={titulo} onClose={onClose} wide>
      <div className="reporte-completo">
        <div className="reporte-cab">
          <span className="list-sub">{detalle}</span>
          {etiqueta}
        </div>
        {descripcion && <p className="reporte-descripcion pre">{descripcion}</p>}
        {fotos.map((f, i) => (
          <figure key={i} className="reporte-foto">
            <span className="reporte-num">
              Foto {i + 1} de {fotos.length}
            </span>
            {f.url ? (
              <button type="button" onClick={() => setVer(f.url!)} title="Ver en pantalla completa">
                <img src={f.url} alt={f.descripcion || `Foto ${i + 1}`} loading="lazy" />
              </button>
            ) : (
              <span className="photo-thumb" />
            )}
            {f.descripcion && <figcaption>{f.descripcion}</figcaption>}
          </figure>
        ))}
      </div>
      {ver && <VerImagen src={ver} alt="Foto del reporte" onClose={() => setVer(null)} />}
    </Modal>
  );
}

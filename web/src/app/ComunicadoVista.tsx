// Comunicado: tarjeta tocable (resumen y miniaturas) y vista completa con el texto y las imágenes en grande.
// La usan el portal (Comunicados e Inicio) y el panel de administración.
import { useState, type ReactNode } from 'react';
import { Badge, Icon, Modal, VerImagen, fecha } from './ui';

export type ComunicadoDatos = { id: string; titulo: string; cuerpo: string; importante?: boolean | null; createdAt: string; autor?: string | null };
/** PDF adjunto: nombre y URL temporal que lo descarga. */
export type Adjunto = { nombre: string; url: string };

/** Tarjeta que se abre al tocarla. `acciones` (Editar/Eliminar) va fuera del área tocable. */
export function TarjetaComunicado({
  c,
  urls,
  adjuntos = [],
  onAbrir,
  acciones,
}: {
  c: ComunicadoDatos;
  urls: string[];
  adjuntos?: Adjunto[];
  onAbrir: () => void;
  acciones?: ReactNode;
}) {
  const mas = urls.length - 3;
  return (
    <article className="panel comunicado">
      <button type="button" className="comunicado-abrir" onClick={onAbrir}>
        <span className="comunicado-cab">
          <strong>{c.titulo}</strong>
          {c.importante && <Badge estado="RECHAZADO">Importante</Badge>}
        </span>
        <span className="small muted">
          {fecha(c.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}
          {c.autor && ` · ${c.autor}`}
        </span>
        <span className="comunicado-resumen">{c.cuerpo}</span>
        {urls.length > 0 && (
          <span className="comunicado-minis">
            {urls.slice(0, 3).map((u, i) => (
              <span key={i} className="comunicado-mini">
                <img src={u} alt="" loading="lazy" />
                {i === 2 && mas > 0 && <span className="comunicado-mas">+{mas}</span>}
              </span>
            ))}
          </span>
        )}
        {adjuntos.length > 0 && (
          <span className="comunicado-pdfs">
            <Icon name="file" />
            {adjuntos.length === 1 ? '1 PDF adjunto' : `${adjuntos.length} PDF adjuntos`}
          </span>
        )}
        <span className="comunicado-ver">
          Ver comunicado
          <Icon name="arrow" />
        </span>
      </button>
      {acciones && <div className="row-actions comunicado-acciones">{acciones}</div>}
    </article>
  );
}

/** Comunicado completo: texto entero y cada imagen a lo ancho; al tocar una imagen se ve en pantalla completa. */
export function ComunicadoCompleto({ c, urls, adjuntos = [], onClose }: { c: ComunicadoDatos; urls: string[]; adjuntos?: Adjunto[]; onClose: () => void }) {
  const [grande, setGrande] = useState<string | null>(null);
  return (
    <Modal title="Comunicado" onClose={onClose} wide>
      <div className="comunicado-completo">
        <h3>
          {c.titulo} {c.importante && <Badge estado="RECHAZADO">Importante</Badge>}
        </h3>
        <p className="small muted">
          {fecha(c.createdAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {c.autor && ` · ${c.autor}`}
        </p>
        <p className="pre">{c.cuerpo}</p>
        {adjuntos.length > 0 && (
          <ul className="comunicado-descargas">
            {adjuntos.map((a) => (
              <li key={a.url}>
                <Icon name="file" />
                <span>{a.nombre}</span>
                <a className="btn-app sm" href={a.url} download={a.nombre}>
                  <Icon name="download" />
                  Descargar
                </a>
              </li>
            ))}
          </ul>
        )}
        {urls.map((u, i) => (
          <button key={i} type="button" className="comunicado-img" onClick={() => setGrande(u)} aria-label={`Ver imagen ${i + 1} en pantalla completa`}>
            <img src={u} alt={`Imagen ${i + 1} del comunicado`} loading="lazy" />
          </button>
        ))}
      </div>
      {grande && <VerImagen src={grande} alt={c.titulo} onClose={() => setGrande(null)} />}
    </Modal>
  );
}

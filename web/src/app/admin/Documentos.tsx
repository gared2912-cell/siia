// Archivos importantes del condominio: el reglamento y otros dos documentos con título libre.
// admin-api firma la subida directa a S3 y la descarga; aquí solo se guarda la referencia en el condominio.
import { useRef, useState } from 'react';
import { adminCall } from '../api';
import { Icon, errMsg, fecha, useToast } from '../ui';
import { useAdmin } from './AdminApp';
import { SLOTS_DOC, SLOTS_GENERALES, documentosDe, type Documento } from '../../../amplify/functions/shared/documentos';

const SLOTS = SLOTS_DOC;

const peso = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Documentos({
  titulo = 'Archivos importantes',
  nota,
  slots = SLOTS_GENERALES,
  seccion = 'condominios',
}: {
  titulo?: string;
  nota?: string;
  slots?: string[];
  seccion?: string;
}) {
  const { condo, puede, reloadCondos } = useAdmin();
  const docs = documentosDe(condo!.documentos);
  const gestiona = puede(seccion, 'editar');
  return (
    <section className="panel">
      <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>{titulo}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        {nota ? `${nota} ` : ''}PDF, Word, Excel o imagen, máximo 20 MB cada uno.
      </p>
      <ul className="list">
        {SLOTS.filter((s) => slots.includes(s.slot)).map((s) => (
          <Fila key={`${condo!.id}-${s.slot}`} conf={s} doc={docs.find((d) => d.slot === s.slot)} gestiona={gestiona} onCambio={reloadCondos} />
        ))}
      </ul>
    </section>
  );
}

function Fila({
  conf,
  doc,
  gestiona,
  onCambio,
}: {
  conf: (typeof SLOTS)[number];
  doc?: Documento;
  gestiona: boolean;
  onCambio: () => void;
}) {
  const { condoId } = useAdmin();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState(conf.titulo ?? doc?.titulo ?? '');
  const [busy, setBusy] = useState('');
  const fijo = !!conf.titulo;

  async function accion(etiqueta: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(etiqueta);
    try {
      await fn();
      toast(ok);
      onCambio();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      setBusy('');
    }
  }

  const subir = (file?: File) => {
    if (!file) return;
    if (!titulo.trim()) return toast('Escribe primero el título del documento.', true);
    accion(
      'subir',
      async () => {
        const r = await adminCall<{ url: string; path: string; contentType: string }>('documentos.subir', {
          condominioId: condoId,
          slot: conf.slot,
          nombre: file.name,
          tamano: file.size,
        });
        const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: file });
        if (!put.ok) throw new Error('No se pudo subir el archivo. Intenta de nuevo.');
        await adminCall('documentos.guardar', { condominioId: condoId, slot: conf.slot, titulo, path: r.path, nombre: file.name });
      },
      `${titulo} guardado`,
    );
  };

  const ver = async () => {
    // La pestaña se abre antes de pedir la URL para que el navegador no la bloquee.
    const w = window.open('', '_blank');
    try {
      const { url } = await adminCall<{ url: string }>('documentos.url', { condominioId: condoId, slot: conf.slot });
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e) {
      w?.close();
      toast(errMsg(e), true);
    }
  };

  const tituloCambio = !fijo && doc && titulo.trim() && titulo.trim() !== doc.titulo;

  return (
    <li style={{ display: 'block' }}>
      <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          {fijo ? (
            <strong style={{ color: 'var(--slate)' }}>{conf.titulo}</strong>
          ) : (
            <input
              className="input"
              style={{ maxWidth: 320 }}
              maxLength={80}
              placeholder={`Título · ${conf.placeholder}`}
              value={titulo}
              disabled={!gestiona || !!busy}
              onChange={(e) => setTitulo(e.target.value)}
              aria-label="Título del documento"
            />
          )}
          <div className="list-sub" style={{ overflowWrap: 'anywhere', marginTop: 4 }}>
            {doc ? `${doc.nombre} · ${peso(doc.tamano)} · subido ${fecha(doc.subido)}` : 'Sin archivo'}
          </div>
        </div>
        <div className="row-actions">
          {tituloCambio && gestiona && (
            <button
              className="btn-app sm"
              disabled={!!busy}
              onClick={() =>
                accion('titulo', () => adminCall('documentos.guardar', { condominioId: condoId, slot: conf.slot, titulo }), 'Título guardado')
              }
            >
              Guardar título
            </button>
          )}
          {doc && (
            <button className="btn-app sm secondary" onClick={ver}>
              <Icon name="file" />
              Ver
            </button>
          )}
          {gestiona && (
            <>
              <input
                ref={input}
                type="file"
                hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                onChange={(e) => {
                  subir(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button className="btn-app sm secondary" disabled={!!busy} onClick={() => input.current?.click()}>
                <Icon name="upload" />
                {busy === 'subir' ? 'Subiendo…' : doc ? 'Reemplazar' : 'Subir archivo'}
              </button>
              {doc && (
                <button
                  className="btn-app sm danger"
                  disabled={!!busy}
                  onClick={() =>
                    confirm(`¿Quitar «${doc.titulo}»?`) &&
                    accion('quitar', () => adminCall('documentos.quitar', { condominioId: condoId, slot: conf.slot }), 'Documento quitado')
                  }
                >
                  Quitar
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

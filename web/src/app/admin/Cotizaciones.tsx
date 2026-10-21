// Panel › Cotizaciones: solicitudes de cotización y mensajes de contacto del sitio público (siia.casa/cotizar y
// /contacto). Cada una es una tarjeta; al tocarla se ve toda la información. Siguen en la campana de todos los
// superadministradores (y de los administradores cuyo rol tenga «Cotizaciones») hasta que alguien marca «Respondido al solicitante» (queda quién y cuándo). Excel con todas.
import { useMemo, useState } from 'react';
import { adminCall } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, useAction, useLoad } from '../ui';
import { useAdmin } from './AdminApp';
import { cerrarNotificaciones } from '../Campana';

export type Cotizacion = {
  id: string;
  origen: 'COTIZACION' | 'CONTACTO';
  estado: 'PENDIENTE' | 'RESPONDIDA';
  nombre: string;
  telefono?: string | null;
  correo?: string | null;
  rol?: string | null;
  tipoDesarrollo?: string | null;
  unidades?: number | null;
  desarrollo?: string | null;
  ubicacion?: string | null;
  administracionActual?: string | null;
  servicios?: string[] | null;
  motivo?: string | null;
  mensaje?: string | null;
  pagina?: string | null;
  respondidaEn?: string | null;
  respondidaPor?: { id: string; nombre?: string; email?: string } | null;
  notaRespuesta?: string | null;
  createdAt: string;
};

export const ORIGEN: Record<Cotizacion['origen'], string> = { COTIZACION: 'Cotización', CONTACTO: 'Contacto' };

export const listaCotizaciones = () => adminCall<Cotizacion[]>('cotizaciones.lista');

export const fechaCompleta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Lo más útil para identificarla de un vistazo: desarrollo, tipo, unidades, ciudad (o el motivo, si es contacto). */
export const resumenCotizacion = (c: Cotizacion) =>
  [c.desarrollo, c.tipoDesarrollo, c.unidades ? `${c.unidades} unidades` : null, c.ubicacion, c.origen === 'CONTACTO' ? c.motivo : null].filter(Boolean).join(' · ');

const soloDigitos = (t?: string | null) => (t ?? '').replace(/\D/g, '');
/** WhatsApp con lada de México si el número viene a 10 dígitos. */
const whatsapp = (t?: string | null) => {
  const d = soloDigitos(t);
  return d.length === 10 ? `52${d}` : d;
};

type Filtro = 'PENDIENTE' | 'RESPONDIDA' | 'TODAS';

export function CotizacionesAdmin({ abrir }: { abrir?: string }) {
  const { firmaReporte } = useAdmin();
  const { data, error, loading, reload } = useLoad(listaCotizaciones);
  const [filtro, setFiltro] = useState<Filtro>('PENDIENTE');
  const [buscar, setBuscar] = useState('');
  const [abiertaId, setAbiertaId] = useState<string | null>(abrir ?? null);
  const { run, busy } = useAction();
  const lista = data ?? [];
  const pendientes = lista.filter((c) => c.estado === 'PENDIENTE').length;
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return lista.filter(
      (c) =>
        (filtro === 'TODAS' || c.estado === filtro) &&
        (!q || [c.nombre, c.telefono, c.correo, c.desarrollo, c.ubicacion, c.tipoDesarrollo, c.motivo].some((x) => x?.toLowerCase().includes(q))),
    );
  }, [lista, filtro, buscar]);
  const abierta = lista.find((c) => c.id === abiertaId) ?? null;

  const descargar = () =>
    run(async () => {
      const { descargarExcelCotizaciones } = await import('./excelCotizaciones');
      await descargarExcelCotizaciones(lista, firmaReporte);
    }, 'Excel descargado');

  return (
    <div className="stack">
      <PageHead icon="inbox" title="Cotizaciones" sub="Solicitudes de cotización y mensajes que llegan desde el sitio web (Cotizar y Contacto).">
        <button className="btn-app secondary" disabled={busy || !lista.length} onClick={descargar}>
          <Icon name="download" />
          Descargar Excel
        </button>
      </PageHead>
      <section className="panel">
        <div className="form-2">
          <Field label="Mostrar" grupo>
            <Seg
              value={filtro}
              onChange={setFiltro}
              options={[
                ['PENDIENTE', `Pendientes${data ? ` (${pendientes})` : ''}`],
                ['RESPONDIDA', 'Respondidas'],
                ['TODAS', 'Todas'],
              ]}
            />
          </Field>
          <Field label="Buscar">
            <input type="search" value={buscar} placeholder="Nombre, teléfono, condominio, ciudad…" onChange={(e) => setBuscar(e.target.value)} />
          </Field>
        </div>
      </section>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : visibles.length ? (
        visibles.map((c) => <TarjetaCotizacion key={c.id} c={c} onAbrir={() => setAbiertaId(c.id)} />)
      ) : (
        <section className="panel">
          <Empty icon="inbox">
            {!lista.length
              ? 'Aún no llegan solicitudes del sitio web.'
              : filtro === 'PENDIENTE' && !buscar
                ? 'No hay solicitudes pendientes. ¡Todo respondido!'
                : 'No hay solicitudes con esos filtros.'}
          </Empty>
        </section>
      )}
      {abierta && <DetalleCotizacion c={abierta} onClose={() => setAbiertaId(null)} onCambio={() => reload(true)} />}
    </div>
  );
}

function TarjetaCotizacion({ c, onAbrir }: { c: Cotizacion; onAbrir: () => void }) {
  const resumen = resumenCotizacion(c);
  return (
    <button type="button" className={`panel reporte-tarjeta cot-tarjeta${c.estado === 'PENDIENTE' ? ' cot-pendiente' : ''}`} onClick={onAbrir}>
      <span className="cot-icono" aria-hidden="true">
        <Icon name={c.origen === 'CONTACTO' ? 'mail' : 'file'} />
      </span>
      <span className="reporte-txt">
        <span className="reporte-cab">
          <strong>{c.nombre}</strong>
          <Badge estado={c.estado === 'PENDIENTE' ? 'PENDIENTE' : 'APROBADO'}>{c.estado === 'PENDIENTE' ? 'Pendiente' : 'Respondida'}</Badge>
        </span>
        <span className="list-sub">
          {ORIGEN[c.origen]} · {fechaCompleta(c.createdAt)}
        </span>
        {resumen && <span className="reporte-resumen">{resumen}</span>}
        {c.estado === 'RESPONDIDA' && (
          <span className="firma">
            Respondida por {c.respondidaPor?.nombre ?? 'un administrador'} · {fechaCompleta(c.respondidaEn)}
          </span>
        )}
        <span className="reporte-ver">
          Ver solicitud completa
          <Icon name="arrow" />
        </span>
      </span>
    </button>
  );
}

function DetalleCotizacion({ c, onClose, onCambio }: { c: Cotizacion; onClose: () => void; onCambio: () => void }) {
  const { puede, superadmin } = useAdmin();
  const { run, busy } = useAction();
  const [nota, setNota] = useState('');
  const datos: [string, string | null | undefined][] = [
    ['Soy…', c.rol],
    ['Teléfono / WhatsApp', c.telefono],
    ['Correo', c.correo],
    ['Motivo', c.motivo],
    ['Tipo de desarrollo', c.tipoDesarrollo],
    ['Casas o departamentos', c.unidades ? String(c.unidades) : null],
    [c.origen === 'CONTACTO' ? 'Condominio / empresa' : 'Condominio o fraccionamiento', c.desarrollo],
    ['Municipio / ciudad', c.ubicacion],
    ['¿Cuentan con administración?', c.administracionActual],
    ['Servicios de interés', c.servicios?.filter(Boolean).join(' · ')],
    [c.origen === 'CONTACTO' ? 'Mensaje' : 'Comentarios', c.mensaje],
    ['Recibida', fechaCompleta(c.createdAt)],
  ];
  const tel = soloDigitos(c.telefono);
  const responder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => adminCall('cotizaciones.responder', { id: c.id, nota }), 'Marcada como respondida')) {
      cerrarNotificaciones((tag) => tag === `cotizacion-${c.id}`);
      onCambio();
    }
  };
  const reabrir = async () => {
    if (!confirm('¿Volver a marcarla como pendiente? Aparecerá otra vez en la campana de los administradores.')) return;
    if (await run(() => adminCall('cotizaciones.reabrir', { id: c.id }), 'De nuevo pendiente')) onCambio();
  };
  return (
    <Modal title={`${ORIGEN[c.origen]} de ${c.nombre}`} onClose={onClose} wide>
      <div className="stack">
        <div className="row-actions">
          {tel && (
            <a className="btn-app sm secondary" href={`tel:${tel}`}>
              <Icon name="phone" />
              Llamar
            </a>
          )}
          {tel && (
            <a className="btn-app sm secondary" href={`https://wa.me/${whatsapp(c.telefono)}`} target="_blank" rel="noopener">
              <Icon name="chat" />
              WhatsApp
            </a>
          )}
          {c.correo && (
            <a className="btn-app sm secondary" href={`mailto:${c.correo}?subject=${encodeURIComponent('SIIA · Tu solicitud de cotización')}`}>
              <Icon name="mail" />
              Correo
            </a>
          )}
        </div>
        <dl className="cot-datos">
          {datos
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {c.estado === 'RESPONDIDA' ? (
          <div className="cot-respondida">
            <Badge estado="APROBADO">Respondida al solicitante</Badge>
            <p style={{ margin: '8px 0 0' }}>
              Por <strong>{c.respondidaPor?.nombre ?? 'un administrador'}</strong>
              {c.respondidaPor?.email && <span className="muted"> ({c.respondidaPor.email})</span>} · {fechaCompleta(c.respondidaEn)}
            </p>
            {c.notaRespuesta && <p className="cot-nota">{c.notaRespuesta}</p>}
            {superadmin && (
              <button className="btn-app sm secondary" disabled={busy} onClick={reabrir} style={{ marginTop: 10 }}>
                Volver a pendiente
              </button>
            )}
          </div>
        ) : puede('cotizaciones', 'editar') ? (
          <form className="stack cot-responder" onSubmit={responder}>
            <Field label="Nota de seguimiento (opcional)" hint="Por ejemplo: «Le llamé, enviamos propuesta por correo».">
              <textarea value={nota} maxLength={1000} onChange={(e) => setNota(e.target.value)} />
            </Field>
            <div>
              <button className="btn-app" disabled={busy}>
                <Icon name="check" />
                Respondido al solicitante
              </button>
            </div>
          </form>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Pendiente de respuesta. Tu rol solo permite consultar las cotizaciones.
          </p>
        )}
      </div>
    </Modal>
  );
}

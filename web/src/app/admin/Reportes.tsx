// Reportes y mejoras (solo el desarrollador): todo lo que los administradores envían con el botón flotante.
// Se cambia el estado y se responde; quien lo envió recibe una notificación y lo ve en «Mis reportes».
import { useState } from 'react';
import { adminCall } from '../api';
import { Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, PageHead, Seg, Tarjeta, TarjetaIcono, Tarjetas, fecha, useAction, useLoad } from '../ui';
import { DetalleReporte, estadoBadge, tonoReporte, type ReporteVista } from './BotonReporte';
import { ESTADOS_REPORTE, TIPOS_REPORTE, type EstadoReporte } from '../../../amplify/functions/shared/reportes';

type Filtro = 'abiertos' | 'FALLA' | 'MEJORA' | 'todos';

export function Reportes() {
  const { data, error, loading, reload } = useLoad(() => adminCall<ReporteVista[]>('reportes.lista'));
  const [filtro, setFiltro] = useState<Filtro>('abiertos');
  const [ver, setVer] = useState<ReporteVista | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const lista = data!;
  const abierto = (r: ReporteVista) => r.estado === 'NUEVO' || r.estado === 'EN_REVISION';
  const vista = lista.filter((r) => (filtro === 'todos' ? true : filtro === 'abiertos' ? abierto(r) : r.tipo === filtro));
  const n = (f: Filtro) => lista.filter((r) => (f === 'abiertos' ? abierto(r) : r.tipo === f)).length;

  return (
    <div className="stack">
      <PageHead icon="flag" title="Reportes y mejoras" sub="Fallas y solicitudes que envían los administradores desde el botón flotante del panel." />
      <Seg
        value={filtro}
        onChange={setFiltro}
        options={[
          ['abiertos', `Por atender (${n('abiertos')})`],
          ['FALLA', `Fallas (${n('FALLA')})`],
          ['MEJORA', `Mejoras (${n('MEJORA')})`],
          ['todos', `Todos (${lista.length})`],
        ]}
      />
      <section className="panel">
        {vista.length ? (
          <Tarjetas>
            {vista.map((r) => (
              <Tarjeta
                key={r.id}
                tono={tonoReporte(r.estado)}
                onClick={() => setVer(r)}
                media={<TarjetaIcono name={r.tipo === 'FALLA' ? 'alert' : 'bulb'} />}
                titulo={r.texto.length > 90 ? `${r.texto.slice(0, 90)}…` : r.texto}
                sub={[TIPOS_REPORTE[r.tipo]?.corto, r.porNombre || r.porEmail, r.condominioNombre, fecha(r.createdAt), r.imagenUrls.length ? `${r.imagenUrls.length} imagen(es)` : null]
                  .filter(Boolean)
                  .join(' · ')}
                lado={<Badge estado={estadoBadge(r.estado)}>{ESTADOS_REPORTE[r.estado]}</Badge>}
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="check">{filtro === 'abiertos' ? 'No hay reportes por atender.' : 'Sin reportes.'}</Empty>
        )}
      </section>
      {ver && (
        <DetalleReporte r={ver} onClose={() => setVer(null)}>
          <Datos
            items={[
              ['Envió', `${ver.porNombre ? `${ver.porNombre} · ` : ''}${ver.porEmail ?? ''}`],
              ['Rol', ver.porRol],
              ['Condominio', ver.condominioNombre],
              ['Sección', ver.pagina],
              ['Navegador', ver.navegador],
            ]}
          />
          <Atender r={ver} onDone={() => (setVer(null), reload(true))} />
        </DetalleReporte>
      )}
    </div>
  );
}

function Atender({ r, onDone }: { r: ReporteVista; onDone: () => void }) {
  const [estado, setEstado] = useState<EstadoReporte>(r.estado === 'NUEVO' ? 'EN_REVISION' : r.estado);
  const [respuesta, setRespuesta] = useState(r.respuesta ?? '');
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => adminCall('reportes.atender', { id: r.id, estado, respuesta }), 'Guardado; se notificó a quien lo envió')) onDone();
  }
  return (
    <form className="form" onSubmit={guardar}>
      <Field label="Estado">
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoReporte)}>
          {(Object.keys(ESTADOS_REPORTE) as EstadoReporte[]).map((k) => (
            <option key={k} value={k}>
              {ESTADOS_REPORTE[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Respuesta (la verá quien lo envió)">
        <textarea rows={3} maxLength={2000} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
      </Field>
      <button className="btn-app" disabled={busy}>
        <Icon name="check" />
        {busy ? 'Guardando…' : 'Guardar y avisar'}
      </button>
    </form>
  );
}

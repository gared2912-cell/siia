import { all, db } from '../api';
import { ErrorBox, Icon, Loading, PageHead, money, hoy, useLoad } from '../ui';
import { useAdmin } from './AdminApp';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function Panel({ go }: { go: (k: string) => void }) {
  const { condo, unidades, puede } = useAdmin();
  const id = condo!.id;
  // Solo se consultan las secciones que el rol puede ver.
  const si = <T,>(seccion: string, fn: () => Promise<T[]>) => (puede(seccion) ? fn() : Promise.resolve([] as T[]));
  const { data, error, loading, reload } = useLoad(async () => {
    const q = { condominioId: id };
    const [perfiles, pagos, cargos, incidentes, reservas, mascotas, visitas] = await Promise.all([
      si('usuarios', () => all((o) => db.models.Perfil.list(o))),
      si('finanzas', () => all((o) => db.models.Pago.pagosPorCondominio(q, o))),
      si('finanzas', () => all((o) => db.models.Cargo.cargosPorCondominio(q, o))),
      si('incidentes', () => all((o) => db.models.Incidente.incidentesPorCondominio(q, o))),
      si('amenidades', () => all((o) => db.models.Reserva.reservasPorCondominio(q, o))),
      si('mascotas', () => all((o) => db.models.Mascota.mascotasPorCondominio(q, o))),
      si('visitas', () => all((o) => db.models.Visita.visitasPorCondominio(q, o))),
    ]);
    const h = hoy();
    const periodo = h.slice(0, 7);
    // Recaudación del mes corriente: los cargos del mes (cuotas, recargos, extraordinarios y reservas). Cada mes empieza de cero.
    const delMes = cargos.filter((c) => c.estado !== 'CANCELADO' && (c.periodo ? c.periodo === periodo : (c.vence ?? '').startsWith(periodo)));
    const enRevision = new Set(pagos.filter((p) => p.estado === 'EN_REVISION').flatMap((p) => (p.cargoIds ?? []).filter(Boolean) as string[]));
    const suma = (l: typeof cargos) => l.reduce((s, c) => s + c.monto, 0);
    const pagado = delMes.filter((c) => c.estado === 'PAGADO');
    const revision = delMes.filter((c) => c.estado === 'PENDIENTE' && enRevision.has(c.id));
    const sinPago = delMes.filter((c) => c.estado === 'PENDIENTE' && !enRevision.has(c.id));
    // Cartera vencida: todo lo pendiente cuya fecha límite ya pasó (de cualquier mes).
    const vencidos = cargos.filter((c) => c.estado === 'PENDIENTE' && c.vence && c.vence < h);
    return {
      residentes: perfiles.filter((p) => p.condominioId === id && p.estado === 'APROBADO' && p.rol === 'RESIDENTE').length,
      pagosRevision: pagos.filter((p) => p.estado === 'EN_REVISION').length,
      recaudacion: {
        periodo,
        generado: delMes.length > 0,
        cobrado: suma(pagado),
        revision: suma(revision),
        porCobrar: suma(sinPago),
        unidadesPagadas: new Set(pagado.map((c) => c.unidadId)).size,
        // Monto de la cuota más reciente: sirve para estimar el mes si no hay cuota configurada en el condominio.
        ultimaCuota: [...cargos].filter((c) => c.id.endsWith('#cuota')).sort((a, b) => String(b.periodo ?? '').localeCompare(String(a.periodo ?? '')))[0]?.monto ?? 0,
      },
      vencido: suma(vencidos),
      unidadesVencidas: new Set(vencidos.map((c) => c.unidadId)).size,
      incidentes: incidentes.filter((i) => i.estado !== 'CERRADO' && i.estado !== 'RESUELTO').length,
      reservas: reservas.filter((r) => r.estado === 'SOLICITADA').length,
      mascotas: mascotas.filter((m) => m.estado === 'PENDIENTE').length,
      dentro: visitas.filter((v) => v.estado === 'DENTRO').length,
    };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data!;
  const plural = condo!.tipoUnidad === 'DEPARTAMENTO' ? 'departamentos' : condo!.tipoUnidad === 'CASA' ? 'casas' : 'unidades';
  const singular = condo!.tipoUnidad === 'DEPARTAMENTO' ? 'departamento' : condo!.tipoUnidad === 'CASA' ? 'casa' : 'unidad';

  // Orilla de color: ámbar si hay algo por atender (rojo si es urgente), verde si está en orden.
  const tarjeta = (label: string, valor: string | number, sub: string, destino: string, alerta = false, tonoAlerta: 'warn' | 'mal' = 'warn') =>
    puede(destino) && (
    <button className={`tile tile-estado t-${alerta ? tonoAlerta : 'ok'}`} style={{ display: 'block' }} onClick={() => go(destino)}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${alerta ? 'is-alert' : ''}`}>{valor}</div>
      <span>{sub}</span>
    </button>
  );
  const pendientes = ['finanzas', 'amenidades', 'mascotas', 'incidentes'].some((s) => puede(s));

  return (
    <div className="stack">
      <PageHead
        icon="chart"
        title="Panel"
        sub={`${condo!.nombre} · ${unidades.length} ${plural}${puede('usuarios') ? ` · ${d.residentes} residentes con acceso` : ''}`}
      />
      {puede('finanzas') && (
        <Recaudacion
          r={d.recaudacion}
          cuotaMensual={condo!.cuotaMensual ?? 0}
          unidades={unidades.length}
          vencido={d.vencido}
          unidadesVencidas={d.unidadesVencidas}
          singular={singular}
          plural={plural}
          onFinanzas={() => go('finanzas')}
        />
      )}
      {puede('usuarios') && (
        <button className="tile tile-acceso" onClick={() => go('residentes')}>
          <Icon name="users" />
          <span className="tile-acceso-txt">
            <strong>Residentes</strong>
            <span>
              {unidades.length} {plural} · {d.residentes} con acceso · chat y contraseña
            </span>
          </span>
          <Icon name="arrow" />
        </button>
      )}
      {!pendientes && !puede('finanzas') && !puede('visitas') && (
        <div className="alert">Tu rol no incluye secciones con indicadores. Usa el menú para ir a tus secciones.</div>
      )}
      {pendientes && <h2 style={{ fontSize: '1.1rem' }}>Pendientes de autorizar</h2>}
      <div className="grid-cards">
        {tarjeta('Pagos por aprobar', d.pagosRevision, 'Comprobantes en revisión', 'finanzas', d.pagosRevision > 0)}
        {tarjeta('Reservas por aprobar', d.reservas, 'Amenidades', 'amenidades', d.reservas > 0)}
        {tarjeta('Mascotas por validar', d.mascotas, 'Programa mascota segura', 'mascotas', d.mascotas > 0)}
        {tarjeta('Incidentes abiertos', d.incidentes, 'Abiertos o en proceso', 'incidentes', d.incidentes > 0, 'mal')}
      </div>
      {puede('visitas') && (
        <div className="grid-cards">
          <button className="tile tile-estado t-info" style={{ display: 'block' }} onClick={() => go('visitas')}>
            <div className="stat-label">Visitas dentro</div>
            <div className="stat-value">{d.dentro}</div>
            <span>Registradas por caseta en este momento</span>
          </button>
        </div>
      )}
    </div>
  );
}

type DatosRecaudacion = { periodo: string; generado: boolean; cobrado: number; revision: number; porCobrar: number; unidadesPagadas: number; ultimaCuota?: number };

/**
 * Recaudación del mes corriente: anillo que representa el 100 % a recaudar; lo cobrado (pagos aprobados) en verde,
 * lo que tiene comprobante por aprobar en ámbar y lo que falta en rojo. Al lado, la cartera vencida como dato informativo.
 */
export function Recaudacion({
  r,
  cuotaMensual,
  unidades,
  vencido,
  unidadesVencidas,
  singular,
  plural,
  onFinanzas,
}: {
  r: DatosRecaudacion;
  cuotaMensual: number;
  unidades: number;
  vencido: number;
  unidadesVencidas: number;
  singular: string;
  plural: string;
  onFinanzas: () => void;
}) {
  // Si las cuotas del mes aún no se generan, el 100 % es la cuota (la configurada o la última generada) por el número de
  // unidades, todo por cobrar.
  const porCobrar = r.generado ? r.porCobrar : (cuotaMensual || r.ultimaCuota || 0) * unidades;
  const total = r.cobrado + r.revision + porCobrar;
  const pct = total ? Math.round((r.cobrado / total) * 100) : 0;
  const [anio, mes] = r.periodo.split('-').map(Number);
  const nombreMes = `${MESES[mes - 1]} de ${anio}`;
  const segmentos = [
    { k: 'cobrado', label: 'Cobrado', valor: r.cobrado, nota: `${r.unidadesPagadas} ${r.unidadesPagadas === 1 ? singular : plural} con pago aprobado` },
    { k: 'revision', label: 'Por confirmar', valor: r.revision, nota: 'Comprobantes en revisión' },
    { k: 'pendiente', label: 'Por cobrar', valor: porCobrar, nota: r.generado ? 'Sin pago este mes' : 'Las cuotas del mes aún no se generan' },
  ];

  // Anillo en SVG: un trazo por segmento con 2px de separación entre ellos.
  const R = 80;
  const C = 2 * Math.PI * R;
  const visibles = segmentos.filter((s) => s.valor > 0);
  const hueco = visibles.length > 1 ? 2 : 0;
  let inicio = 0;
  const arcos = visibles.map((s) => {
    const largo = (s.valor / total) * C;
    const a = { ...s, dash: `${Math.max(largo - hueco, 0.5)} ${C}`, offset: -inicio };
    inicio += largo;
    return a;
  });

  return (
    <section className="panel recaudo">
      <div className="panel-head">
        <h2>Recaudación de {nombreMes}</h2>
        <button className="linklike" onClick={onFinanzas}>
          Ir a Finanzas
        </button>
      </div>
      <div className="recaudo-cuerpo">
        <div className="recaudo-grafica">
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={`Recaudación de ${nombreMes}: cobrado ${money(r.cobrado)} de ${money(total)} (${pct} %), por confirmar ${money(r.revision)}, por cobrar ${money(porCobrar)}.`}
          >
            <circle cx="100" cy="100" r={R} className="recaudo-fondo" />
            {arcos.map((a) => (
              <circle
                key={a.k}
                cx="100"
                cy="100"
                r={R}
                className={`recaudo-arco ${a.k}`}
                strokeDasharray={a.dash}
                strokeDashoffset={a.offset}
                transform="rotate(-90 100 100)"
              >
                <title>{`${a.label}: ${money(a.valor)} (${Math.round((a.valor / total) * 100)} %)`}</title>
              </circle>
            ))}
          </svg>
          <div className="recaudo-centro">
            <strong>{pct}%</strong>
            <span>cobrado</span>
            <small>de {money(total)}</small>
          </div>
        </div>
        <ul className="recaudo-leyenda">
          {segmentos.map((s) => (
            <li key={s.k} className={s.k}>
              <span className="recaudo-punto" aria-hidden="true" />
              <span className="recaudo-txt">
                <span>{s.label}</span>
                <small>{s.nota}</small>
              </span>
              <strong>{money(s.valor)}</strong>
            </li>
          ))}
          <li className="total">
            <span className="recaudo-txt">
              <span>Total a recaudar del mes</span>
            </span>
            <strong>{money(total)}</strong>
          </li>
        </ul>
        <button type="button" className={`recaudo-vencida ${vencido > 0 ? 't-mal' : 't-ok'}`} onClick={onFinanzas}>
          <span className="stat-label">Cartera vencida</span>
          <strong>{money(vencido)}</strong>
          <span>
            {vencido > 0
              ? `${unidadesVencidas} ${unidadesVencidas === 1 ? singular : plural} con pagos vencidos`
              : `${singular === 'departamento' ? 'Ningún' : 'Ninguna'} ${singular} con pagos vencidos`}
          </span>
          <small>Incluye meses anteriores · ver detalle en Finanzas</small>
        </button>
      </div>
    </section>
  );
}

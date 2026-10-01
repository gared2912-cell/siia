import { all, client } from '../api';
import { ErrorBox, Loading, PageHead, money, hoy, useLoad } from '../ui';
import { useAdmin } from './AdminApp';

export function Panel({ go }: { go: (k: string) => void }) {
  const { condo, unidades } = useAdmin();
  const id = condo!.id;
  const { data, error, loading, reload } = useLoad(async () => {
    const q = { condominioId: id };
    const [perfiles, pagos, cargos, incidentes, reservas, mascotas, visitas] = await Promise.all([
      all((o) => client.models.Perfil.list(o)),
      all((o) => client.models.Pago.pagosPorCondominio(q, o)),
      all((o) => client.models.Cargo.cargosPorCondominio(q, o)),
      all((o) => client.models.Incidente.incidentesPorCondominio(q, o)),
      all((o) => client.models.Reserva.reservasPorCondominio(q, o)),
      all((o) => client.models.Mascota.mascotasPorCondominio(q, o)),
      all((o) => client.models.Visita.visitasPorCondominio(q, o)),
    ]);
    const h = hoy();
    const pendientes = cargos.filter((c) => c.estado === 'PENDIENTE');
    return {
      solicitudes: perfiles.filter((p) => p.estado === 'PENDIENTE').length,
      residentes: perfiles.filter((p) => p.condominioId === id && p.estado === 'APROBADO' && p.rol === 'RESIDENTE').length,
      pagosRevision: pagos.filter((p) => p.estado === 'EN_REVISION').length,
      porCobrar: pendientes.reduce((s, c) => s + c.monto, 0),
      vencido: pendientes.filter((c) => c.vence && c.vence < h).reduce((s, c) => s + c.monto, 0),
      cobradoMes: pagos.filter((p) => p.estado === 'VALIDADO' && (p.validadoEn ?? '').slice(0, 7) === h.slice(0, 7)).reduce((s, p) => s + p.monto, 0),
      incidentes: incidentes.filter((i) => i.estado === 'ABIERTO' || i.estado === 'EN_PROCESO').length,
      reservas: reservas.filter((r) => r.estado === 'SOLICITADA').length,
      mascotas: mascotas.filter((m) => m.estado === 'PENDIENTE').length,
      dentro: visitas.filter((v) => v.estado === 'DENTRO').length,
    };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data!;

  const tarjeta = (label: string, valor: string | number, sub: string, destino: string, alerta = false) => (
    <button className="tile" style={{ display: 'block' }} onClick={() => go(destino)}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${alerta ? 'is-alert' : ''}`}>{valor}</div>
      <span>{sub}</span>
    </button>
  );

  return (
    <div className="stack">
      <PageHead icon="chart" title="Panel" sub={`${condo!.nombre} · ${unidades.length} unidades · ${d.residentes} residentes con acceso`} />
      <h2 style={{ fontSize: '1.1rem' }}>Pendientes de autorizar</h2>
      <div className="grid-cards">
        {tarjeta('Solicitudes de acceso', d.solicitudes, 'Todos los condominios', 'usuarios', d.solicitudes > 0)}
        {tarjeta('Pagos por aprobar', d.pagosRevision, 'Comprobantes en revisión', 'finanzas', d.pagosRevision > 0)}
        {tarjeta('Reservas por aprobar', d.reservas, 'Amenidades', 'amenidades', d.reservas > 0)}
        {tarjeta('Mascotas por validar', d.mascotas, 'Programa mascota segura', 'mascotas', d.mascotas > 0)}
        {tarjeta('Incidentes abiertos', d.incidentes, 'Abiertos o en proceso', 'incidentes', d.incidentes > 0)}
      </div>
      <h2 style={{ fontSize: '1.1rem', marginTop: 24 }}>Situación del condominio</h2>
      <div className="grid-cards">
        {tarjeta('Por cobrar', money(d.porCobrar), `Vencido: ${money(d.vencido)}`, 'finanzas', d.vencido > 0)}
        {tarjeta('Cobrado este mes', money(d.cobradoMes), 'Pagos validados', 'finanzas')}
        {tarjeta('Visitas dentro', d.dentro, 'Registradas por caseta', 'visitas')}
      </div>
    </div>
  );
}

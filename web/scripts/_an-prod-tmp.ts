import { readFileSync } from 'node:fs';
import { sinCuotaCompleta } from '../amplify/functions/shared/cuotas';
import { esCuotaManual, periodoDeCuota, cuotaProporcional } from '../amplify/functions/shared/finanzas';
const u = (x: any): any => x.S ?? (x.N !== undefined ? +x.N : x.BOOL ?? (x.NULL ? null : x.L ? x.L.map(u) : x.M ? Object.fromEntries(Object.entries(x.M).map(([k, v]) => [k, u(v)])) : x.SS ?? x));
const L = (t: string) => JSON.parse(readFileSync(process.env.TEMP + '/prod/' + t + '.json', 'utf8')).Items.map((i: any) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, u(v)])));
const [U, G, P] = ['Unidad', 'Cargo', 'Pago'].map(L);
const mx = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));
const et = (id: string) => U.find((x: any) => x.id === id)?.etiqueta ?? '?';
const pagosDe = (c: any) => P.filter((p: any) => (p.cargoIds ?? []).includes(c.id)).map((p: any) => `${p.estado} $${p.monto} (${p.fecha})`);
console.log('Unidades sin fecha de entrega:', U.filter((x: any) => !x.fechaEntrega).map((x: any) => x.etiqueta).join(', ') || 'ninguna');
console.log('Entregas por mes:', JSON.stringify(U.reduce((a: any, x: any) => ((a[(x.fechaEntrega ?? 'sin').slice(0, 7)] = (a[(x.fechaEntrega ?? 'sin').slice(0, 7)] ?? 0) + 1), a), {})));
console.log('Cargos PAGADO:', G.filter((c: any) => c.estado === 'PAGADO').length, '| Pagos por estado:', JSON.stringify(P.reduce((a: any, p: any) => ((a[p.estado] = (a[p.estado] ?? 0) + 1), a), {})));
console.log('\n=== Noviembre: unidades a las que NO les corresponde la completa');
for (const un of [...U].sort((a: any, b: any) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))) {
  const cs = G.filter((c: any) => c.unidadId === un.id);
  const auto = cs.find((c: any) => c.id === `${un.id}#2026-11#cuota` && c.estado !== 'CANCELADO');
  if (!auto) continue;
  const m = sinCuotaCompleta(un, cs, '2026-11', { fechaCargo: '2026-11-01' });
  if (!m) continue;
  const man = cs.filter((c: any) => esCuotaManual(c) && periodoDeCuota(c) === '2026-11');
  console.log(`${un.etiqueta} entrega ${un.fechaEntrega} alta ${mx(un.createdAt)} motivo ${m}`);
  for (const c of [auto, ...man]) console.log(`   ${c.id === auto.id ? 'AUTO  ' : 'MANUAL'} «${c.concepto}» $${c.monto} ${c.estado} pagos: ${pagosDe(c).join(' | ') || '-'}`);
}
console.log('\n=== Cargos manuales de cuota/proporcional: monto capturado vs. calculado con la fecha de entrega');
for (const c of G.filter((c: any) => esCuotaManual(c)).sort((a: any, b: any) => et(a.unidadId).localeCompare(et(b.unidadId), 'es', { numeric: true }))) {
  const un = U.find((x: any) => x.id === c.unidadId);
  const per = periodoDeCuota(c);
  let calc = 0;
  if (un?.fechaEntrega?.slice(0, 7) === per) calc = cuotaProporcional(450, un.fechaEntrega).monto;
  else if (un?.fechaEntrega && un.fechaEntrega.slice(0, 7) < per) calc = 450;
  const dif = Math.abs(calc - c.monto) > 1 ? `DIF (calc $${calc})` : 'ok';
  console.log(`${et(c.unidadId)} entrega ${un?.fechaEntrega} | ${c.tipo} «${c.concepto}» per ${per} $${c.monto} ${c.estado} | ${dif} | pagos: ${pagosDe(c).join(' | ') || '-'}`);
}
console.log('\n=== Entregados en octubre SIN cargo proporcional de octubre');
for (const un of U.filter((x: any) => x.fechaEntrega?.startsWith('2026-10'))) {
  const cs = G.filter((c: any) => c.unidadId === un.id && esCuotaManual(c) && periodoDeCuota(c) === '2026-10');
  if (!cs.length) console.log(`${un.etiqueta} entrega ${un.fechaEntrega} → calc $${cuotaProporcional(450, un.fechaEntrega).monto}`);
}

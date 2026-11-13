// Vista previa del estado financiero mensual (Finanzas del condominio): lo mismo que el PDF, adaptado al celular.
import { svgDistribucion, svgIngresosEgresos } from './graficasFinanzas';
import { filasResultados, nombreMesLargo, fechaLarga, proporcion, type EstadoFinanciero } from './estadoFinanciero';
import { money } from './ui';

const pct = (p: number | null) => (p === null ? '' : `${(p * 100).toFixed(1)}%`);

function Tabla({ titulo, cols = ['Monto', '%'], filas, total }: { titulo: string; cols?: [string, string]; filas: [string, number, number | null, boolean?][]; total?: [string, number, number | null] }) {
  return (
    <table className="ef-tabla">
      <thead>
        <tr>
          <th>{titulo}</th>
          <th className="num">{cols[0]}</th>
          <th className="num">{cols[1]}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(([t, v, p, apagado], i) => (
          <tr key={i} className={apagado ? 'ef-apagado' : undefined}>
            <td>{t}</td>
            <td className="num">{money(v)}</td>
            <td className="num">{pct(p)}</td>
          </tr>
        ))}
        {total && (
          <tr className="ef-subtotal">
            <td>{total[0]}</td>
            <td className="num">{money(total[1])}</td>
            <td className="num">{pct(total[2])}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function EstadoFinancieroVista({ e }: { e: EstadoFinanciero }) {
  const pi = (n: number) => proporcion(n, e.totalIngresos);
  const pe = (n: number) => proporcion(n, e.totalEgresos);
  const g1 = svgIngresosEgresos(e.serie);
  const g2 = svgDistribucion(e.egresos.map((x) => ({ label: x.categoria, monto: x.monto })));
  const c = e.cobranza;
  return (
    <div className="ef">
      <div className="ef-cab">
        <strong>ESTADO FINANCIERO MENSUAL</strong>
        <span>{e.condominio}</span>
        <span className="small muted">
          {nombreMesLargo(e.periodo)} · Elaborado el {fechaLarga(e.elaborado)}
        </span>
      </div>

      <div className="ef-kpis">
        {(
          [
            ['Saldo inicial', e.saldoInicial],
            ['Ingresos del mes', e.totalIngresos],
            ['Egresos del mes', e.totalEgresos],
            ['Saldo final', e.saldoFinal],
          ] as [string, number][]
        ).map(([t, v], i) => (
          <div key={t} className={`ef-kpi${i === 3 ? ' final' : ''}`}>
            <span>{t}</span>
            <strong className={v < 0 ? 'neg' : undefined}>{money(v)}</strong>
          </div>
        ))}
      </div>

      <section className="ef-sec">
        <h3>Ingresos</h3>
        <Tabla
          titulo="Ingresos ordinarios"
          filas={e.ordinarios.map((x) => [x.label, x.monto, pi(x.monto), !x.monto])}
          total={['Subtotal ingresos ordinarios', e.totalOrdinarios, pi(e.totalOrdinarios)]}
        />
        <Tabla
          titulo="Ingresos por amenidades"
          filas={
            e.amenidades.length
              ? e.amenidades.map((a) => [`${a.nombre} (${a.reservas} reserva${a.reservas === 1 ? '' : 's'})`, a.monto, pi(a.monto)])
              : [['Sin reservas pagadas en el mes', 0, null, true]]
          }
          total={['Subtotal ingresos por amenidades', e.totalAmenidades, pi(e.totalAmenidades)]}
        />
        <div className="ef-total">
          <span>Total de ingresos</span>
          <strong>{money(e.totalIngresos)}</strong>
        </div>
      </section>

      <section className="ef-sec">
        <h3>Egresos</h3>
        <Tabla titulo="Concepto" filas={e.egresos.length ? e.egresos.map((x) => [x.categoria, x.monto, pe(x.monto)]) : [['Sin egresos registrados en el mes', 0, null, true]]} />
        <p className="small muted ef-nota">
          {e.movimientosEgreso} movimiento{e.movimientosEgreso === 1 ? '' : 's'} con evidencia.
        </p>
        <div className="ef-total">
          <span>Total de egresos</span>
          <strong>{money(e.totalEgresos)}</strong>
        </div>
      </section>

      <section className="ef-sec">
        <h3>Estado de resultados</h3>
        <table className="ef-tabla">
          <tbody>
            {filasResultados(e).map(([t, v, total]) => (
              <tr key={t} className={total ? 'ef-resultado' : undefined}>
                <td>{t}</td>
                <td className="num">{money(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {e.notaSaldoInicial && <p className="small muted ef-nota">{e.notaSaldoInicial}</p>}
      </section>

      <section className="ef-sec">
        <h3>Cobranza del mes</h3>
        <table className="ef-tabla">
          <tbody>
            <tr>
              <td>Cargos emitidos en el mes</td>
              <td className="num">{money(c.emitido)}</td>
              <td className="num" />
            </tr>
            <tr>
              <td>Cobrado</td>
              <td className="num">{money(c.cobrado)}</td>
              <td className="num">{pct(proporcion(c.cobrado, c.emitido))}</td>
            </tr>
            <tr>
              <td>Pendiente de cobro</td>
              <td className="num">{money(c.pendiente)}</td>
              <td className="num">{pct(proporcion(c.pendiente, c.emitido))}</td>
            </tr>
            <tr>
              <td>Unidades al corriente</td>
              <td className="num">{c.alCorriente}</td>
              <td className="num" />
            </tr>
            <tr>
              <td>Unidades con adeudo vencido</td>
              <td className={`num${c.conAdeudo ? ' neg' : ''}`}>{c.conAdeudo}</td>
              <td className="num" />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="ef-sec">
        <h3>Ingresos vs. egresos · últimos 6 meses</h3>
        <div className="ef-grafica" dangerouslySetInnerHTML={{ __html: g1.svg }} />
      </section>
      <section className="ef-sec">
        <h3>Distribución de egresos del mes</h3>
        {e.egresos.length ? (
          <div className="ef-grafica" dangerouslySetInnerHTML={{ __html: g2.svg }} />
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Sin egresos registrados en el mes.
          </p>
        )}
      </section>
    </div>
  );
}

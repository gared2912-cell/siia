// Recibo de pago imprimible (se genera a partir de un pago validado con folio).
import { Icon, fecha, money } from './ui';

export type ReciboData = {
  pago: { id: string; folio?: string; monto: number; fecha?: string; referencia?: string; validadoEn?: string };
  cargos: { id: string; concepto: string; monto: number }[];
  condominio: { nombre: string; direccion?: string };
  unidad: { etiqueta: string; propietario?: string };
};

export function Recibo({ data }: { data: ReciboData }) {
  const { pago, cargos, condominio, unidad } = data;
  const imprimir = () => {
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 500);
  };
  return (
    <>
      <div className="recibo">
        <div className="recibo-head">
          <img src="/logo-siia.png" alt="SIIA" />
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">Recibo de pago</div>
            <div className="codigo">{pago.folio}</div>
            <div className="small">Validado el {fecha(pago.validadoEn)}</div>
          </div>
        </div>
        <p style={{ margin: '0 0 4px' }}>
          <strong>{condominio.nombre}</strong>
        </p>
        {condominio.direccion && <p className="small muted" style={{ margin: 0 }}>{condominio.direccion}</p>}
        <p style={{ margin: '12px 0' }}>
          Unidad: <strong>{unidad.etiqueta}</strong>
          {unidad.propietario && ` · ${unidad.propietario}`}
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Importe</th>
            </tr>
          </thead>
          <tbody>
            {cargos.length ? (
              cargos.map((c) => (
                <tr key={c.id}>
                  <td>{c.concepto}</td>
                  <td className="num">{money(c.monto)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>Pago a cuenta de mantenimiento</td>
                <td className="num">{money(pago.monto)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="recibo-total" style={{ marginTop: 12 }}>
          Total recibido: {money(pago.monto)}
        </div>
        <p className="small muted" style={{ marginTop: 16 }}>
          Fecha de pago: {fecha(pago.fecha)}
          {pago.referencia && ` · Referencia: ${pago.referencia}`}
          <br />
          SIIA · Sistemas Integrales Inmobiliarios y de Administración · Documento sin validez fiscal.
        </p>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn-app" onClick={imprimir}>
          <Icon name="print" />
          Imprimir o guardar PDF
        </button>
      </div>
    </>
  );
}

// Finanzas › Balance › Ingresos: al tocar una categoría (cuota corriente, recuperación de cartera, extraordinarias,
// multas, ahorro, otros) o una amenidad se ve de dónde sale ese monto: qué pagos del mes lo forman, de qué casa o
// departamento, quién es el residente y qué conceptos cubrió. Cada pago abre su ficha, su recibo y su comprobante.
import { useState, type CSSProperties } from 'react';
import { adminCall } from '../api';
import { Recibo, cargoRecibo, pagoRecibo } from '../Recibo';
import { Acciones, Archivo, Datos, Empty, Icon, Modal, Tarjeta, Tarjetas, fecha, money, useLoad } from '../ui';
import { useAdmin } from './AdminApp';
import { aportesDeIngreso, fechaIngreso, nombreMes, type AporteIngreso, type DatosFinanzas, type FiltroIngreso } from './balance';
import { conciliacionDe } from '../../../amplify/functions/shared/conciliacion';

type Contactos = Record<string, { nombre: string | null; telefono?: string | null; email: string }[]>;

export function DetalleIngreso({
  datos,
  mes,
  filtro,
  titulo,
  color,
  onClose,
}: {
  datos: DatosFinanzas;
  mes: string;
  filtro: FiltroIngreso;
  titulo: string;
  color?: string;
  onClose: () => void;
}) {
  const { condo, unidades, etiqueta } = useAdmin();
  const contactos = useLoad(() => adminCall<Contactos>('finanzas.contactos', { condominioId: condo!.id }).catch(() => ({}) as Contactos), [condo?.id]);
  const [ficha, setFicha] = useState<AporteIngreso | null>(null);
  const [verRecibo, setVerRecibo] = useState(false);
  const aportes = aportesDeIngreso(datos, mes, filtro).sort(
    (a, b) => etiqueta(a.pago.unidadId).localeCompare(etiqueta(b.pago.unidadId), 'es', { numeric: true }) || fechaIngreso(a.pago).localeCompare(fechaIngreso(b.pago)),
  );
  const total = aportes.reduce((s, a) => s + a.monto, 0);
  const nUnidades = new Set(aportes.map((a) => a.pago.unidadId)).size;
  const residentes = (unidadId: string) => {
    const lista = contactos.data?.[unidadId] ?? [];
    const nombres = lista.map((c) => c.nombre).filter(Boolean) as string[];
    if (nombres.length) return nombres.join(', ');
    return unidades.find((u) => u.id === unidadId)?.propietario || 'Sin residente registrado';
  };
  const cargosPorId = new Map(datos.cargos.map((c) => [c.id, c]));

  // Recibo del pago elegido
  if (ficha && verRecibo) {
    const p = ficha.pago;
    const u = unidades.find((x) => x.id === p.unidadId);
    return (
      <Modal title={`Recibo ${p.folio ?? ''}`} onClose={onClose}>
        <button type="button" className="linklike" onClick={() => setVerRecibo(false)} style={{ marginBottom: 10 }}>
          <Icon name="back" /> Regresar al pago
        </button>
        <Recibo
          data={{
            pago: pagoRecibo(p),
            cargos: (p.cargoIds ?? []).map((id) => (id ? cargosPorId.get(id) : undefined)).filter((c): c is NonNullable<typeof c> => !!c).map(cargoRecibo),
            condominio: { nombre: condo!.nombre, direccion: condo!.direccion ?? undefined },
            unidad: { etiqueta: u?.etiqueta ?? '', propietario: u?.propietario ?? undefined },
          }}
        />
      </Modal>
    );
  }

  // Ficha de un pago
  if (ficha) {
    const p = ficha.pago;
    const conc = conciliacionDe(p);
    const tels = (contactos.data?.[p.unidadId] ?? []).map((c) => c.telefono).filter(Boolean).join(', ');
    return (
      <Modal title={`${etiqueta(p.unidadId)} · ${titulo}`} onClose={onClose}>
        <div className="stack">
          <button type="button" className="linklike" onClick={() => setFicha(null)}>
            <Icon name="back" /> Regresar a {titulo.toLowerCase()}
          </button>
          <div className="row-actions">
            <strong className="detalle-aporte">{money(ficha.monto)}</strong>
            <span className="small muted">aportado a {titulo.toLowerCase()}</span>
          </div>
          <Datos
            items={[
              ['Casa o departamento', etiqueta(p.unidadId)],
              ['Residente', residentes(p.unidadId)],
              ['Teléfono', tels || null],
              ['Folio de recibo', p.folio],
              ['Fecha de pago', fecha(fechaIngreso(p))],
              ['Monto total del pago', money(p.monto)],
              ['Referencia', p.referencia],
              [
                'Conciliado con el banco',
                conc ? `Depósito del ${fecha(conc.fecha)} por ${money(conc.monto)}${conc.ordenante ? ` de ${conc.ordenante}` : ''}${conc.banco ? ` (${conc.banco})` : ''}` : null,
              ],
            ]}
          />
          <div>
            <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>
              Qué cubrió en {titulo.toLowerCase()}
            </div>
            <ul className="detalle-conceptos">
              {ficha.conceptos.map((c, i) => (
                <li key={i}>
                  <span>{c.concepto}</span>
                  <strong>{money(c.monto)}</strong>
                </li>
              ))}
            </ul>
            {ficha.monto < p.monto - 0.004 && (
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                El resto del pago ({money(p.monto - ficha.monto)}) se cuenta en otra categoría.
              </p>
            )}
          </div>
          <Acciones>
            <button type="button" className="btn-app" onClick={() => setVerRecibo(true)}>
              <Icon name="file" />
              Ver recibo
            </button>
            <Archivo path={p.comprobantePath} origen={{ model: 'Pago', id: p.id }} label="Ver comprobante" />
          </Acciones>
        </div>
      </Modal>
    );
  }

  // Lista de pagos de la categoría
  return (
    <Modal title={`${titulo} · ${nombreMes(mes)}`} onClose={onClose}>
      <div className="stack">
        <div className="detalle-resumen" style={color ? ({ '--cat': color } as CSSProperties) : undefined}>
          <span className="detalle-punto" />
          <div>
            <strong>{money(total)}</strong>
            <span>
              {aportes.length} pago{aportes.length === 1 ? '' : 's'} · {nUnidades} {nUnidades === 1 ? 'casa o departamento' : 'casas o departamentos'}
            </span>
          </div>
        </div>
        {aportes.length ? (
          <Tarjetas>
            {aportes.map((a) => (
              <Tarjeta
                key={a.pago.id}
                tono="ok"
                onClick={() => setFicha(a)}
                label={`Ver el pago de ${etiqueta(a.pago.unidadId)}`}
                titulo={etiqueta(a.pago.unidadId)}
                sub={`${contactos.loading && !contactos.data ? '…' : residentes(a.pago.unidadId)} · Pagado el ${fecha(fechaIngreso(a.pago))}${a.pago.folio ? ` · ${a.pago.folio}` : ''}`}
                lado={
                  <>
                    <strong>{money(a.monto)}</strong>
                    {a.monto < a.pago.monto - 0.004 && <span className="small muted">de {money(a.pago.monto)}</span>}
                  </>
                }
              >
                <span className="small muted">{a.conceptos.map((c) => c.concepto).join(' · ')}</span>
              </Tarjeta>
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="inbox">No hubo pagos en esta categoría en {nombreMes(mes).toLowerCase()}.</Empty>
        )}
      </div>
    </Modal>
  );
}

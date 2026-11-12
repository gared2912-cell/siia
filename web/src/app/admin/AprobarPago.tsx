// Aprobar un comprobante: la administración confirma el monto que muestra el comprobante y, si no cuadra con los
// cargos que cubre, decide qué pasa con la diferencia (queda pendiente o se condona) o con el excedente (saldo a
// favor de la casa o departamento, u otro ingreso). El reparto es el mismo que hace admin-api (shared/pagos.ts).
import { useState } from 'react';
import { adminCall, type Schema } from '../api';
import { Archivo, Field, Icon, Modal, money, useAction } from '../ui';
import { useAdmin } from './AdminApp';
import { ajusteDe, favorAUsar, r2, repartirPago, type Excedente, type Faltante } from '../../../amplify/functions/shared/pagos';
import { QUE_PAGA_RESIDENTE, categoriasDe, etiquetaCategoria, partesDePago, type CategoriaIngreso } from '../../../amplify/functions/shared/finanzas';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];

/** El mismo archivo ya estaba en otro pago del condominio (lo marca portal-api al registrar el comprobante). */
export type Repetido = { pagoId: string; unidadId: string; monto: number; fecha?: string | null; estado?: string | null; folio?: string | null };
export function repetidoDe(p: { comprobanteRepetido?: unknown }): Repetido | null {
  let r = p.comprobanteRepetido;
  for (let k = 0; k < 2 && typeof r === 'string'; k++) {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  return r && typeof r === 'object' && typeof (r as Repetido).pagoId === 'string' ? (r as Repetido) : null;
}
const ESTADO_PREVIO: Record<string, string> = { EN_REVISION: 'por aprobar', VALIDADO: 'aprobado', RECHAZADO: 'rechazado' };

/** Nota para la administración: este comprobante ya se había subido antes; hay que revisarlo y aprobarlo a mano. */
export function NotaRepetido({ pago, etiqueta }: { pago: Pago; etiqueta: (id: string) => string }) {
  const r = repetidoDe(pago);
  if (!r || pago.estado !== 'EN_REVISION') return null;
  const otraUnidad = r.unidadId !== pago.unidadId;
  return (
    <div className="revisar-nota">
      <strong>⚠ Comprobante repetido</strong>
      <p>
        Este mismo archivo ya se había subido antes{otraUnidad ? ` por ${etiqueta(r.unidadId)}` : ''}: pago de {money(r.monto)}
        {r.fecha ? ` del ${r.fecha.split('-').reverse().join('/')}` : ''}, {ESTADO_PREVIO[r.estado ?? ''] ?? 'registrado'}
        {r.folio ? ` con el recibo ${r.folio}` : ''}. Revísalo personalmente antes de aprobarlo; el match automático no lo toma.
      </p>
    </div>
  );
}

/** Cargos pendientes que cubre un comprobante (los ya pagados o cancelados no cuentan). */
export const cargosDelPago = (p: Pago, cargos: Cargo[]) => cargos.filter((c) => (p.cargoIds ?? []).includes(c.id) && c.estado === 'PENDIENTE');

/** Otros cargos pendientes de la unidad a los que se puede abonar un excedente (sin los que ya tiene otro comprobante en revisión). */
export function otrosPendientes(unidadId: string, excluir: (string | null)[], cargos: Cargo[], pagos: Pago[]) {
  const enRevision = new Set(pagos.filter((p) => p.estado === 'EN_REVISION').flatMap((p) => p.cargoIds ?? []));
  return cargos
    .filter((c) => c.unidadId === unidadId && c.estado === 'PENDIENTE' && !excluir.includes(c.id) && !enRevision.has(c.id))
    .sort((a, b) => String(a.vence ?? '9999').localeCompare(String(b.vence ?? '9999')));
}

export function AprobarPago({ pago, cargos, pagos, onClose, onDone }: { pago: Pago; cargos: Cargo[]; pagos: Pago[]; onClose: () => void; onDone: () => void }) {
  const { etiqueta, unidades, reloadUnidades, condo } = useAdmin();
  const cats = categoriasDe(condo);
  const cubre = cargosDelPago(pago, cargos);
  const otros = otrosPendientes(pago.unidadId, pago.cargoIds ?? [], cargos, pagos.filter((p) => p.id !== pago.id));
  const total = r2(cubre.reduce((s, c) => s + c.monto, 0));
  const favor = unidades.find((u) => u.id === pago.unidadId)?.saldoFavor ?? 0;
  const [monto, setMonto] = useState(String(pago.monto));
  const [usar, setUsar] = useState(favor > 0 && total > 0 && (!!pago.usarSaldoFavor || pago.monto < total));
  const [faltante, setFaltante] = useState<Faltante>('PENDIENTE');
  const [excedente, setExcedente] = useState<Excedente>('SALDO_FAVOR');
  const [nota, setNota] = useState('');
  const repetido = repetidoDe(pago);
  const [revisado, setRevisado] = useState(false);
  // Si sobra, el sistema propone abonarlo a los otros cargos pendientes de la unidad (todos marcados).
  const [extras, setExtras] = useState<string[]>(otros.map((c) => c.id));
  // Desglose por categoría: null = el automático (por los cargos que cubre y la fecha de pago).
  const [desglose, setDesglose] = useState<{ categoria: string; monto: string }[] | null>(null);
  const { run, busy } = useAction();

  const recibido = r2(Number(monto) || 0);
  const favorUsado = usar ? favorAUsar(favor, total, recibido) : 0;
  const plan = repartirPago(cubre, recibido + favorUsado);
  // Abono del excedente a otros cargos (mismo criterio que admin-api: una reserva no se abona a medias).
  const sobra = plan.diferencia > 0.004;
  const pe = sobra ? repartirPago(otros.filter((c) => extras.includes(c.id)), plan.diferencia) : null;
  const parcialExtra = pe?.parcial && !pe.parcial.cargo.id.startsWith('reserva#') ? pe.parcial : null;
  const abonado = pe ? r2(pe.pagados.reduce((s, c) => s + c.monto, 0) + (parcialExtra?.pagado ?? 0)) : 0;
  const diferencia = r2(plan.diferencia - abonado);
  const ajuste = ajusteDe(diferencia, faltante, excedente);
  const dif = Math.abs(diferencia);
  const tono = ajuste === 'COMPLETO' ? 'ok' : diferencia < 0 ? 'warn' : 'info';
  const resultado =
    ajuste === 'COMPLETO'
      ? abonado
        ? 'Todo queda cubierto'
        : 'Pago completo'
      : diferencia < 0
        ? `Faltan ${money(dif)}`
        : total || abonado
          ? `Sobran ${money(dif)}`
          : `Pago a cuenta de ${money(dif)}`;

  // Cómo quedaría en el balance: por categoría según los cargos que se liquidan y la fecha de pago.
  const abonados = sobra ? [...(pe?.pagados ?? []), ...(parcialExtra ? [parcialExtra.cargo] : [])].map((c) => c.id) : [];
  const automatico = agrupar(
    partesDePago({ ...pago, monto: recibido, desglose: null, cargoIds: [...cubre.map((c) => c.id), ...abonados] }, new Map(cargos.map((c) => [c.id, c]))),
  );
  const sumaDesglose = r2((desglose ?? []).reduce((s, d) => s + (Number(d.monto) || 0), 0));
  const desgloseOk = !desglose || Math.abs(sumaDesglose - recibido) < 0.01;
  const abrirDesglose = () =>
    setDesglose(
      automatico.length
        ? automatico.map((x) => ({ categoria: x.categoria, monto: String(x.monto) }))
        : [{ categoria: pago.categoriaResidente || 'CORRIENTE', monto: String(recibido) }],
    );

  async function aprobar(e: React.FormEvent) {
    e.preventDefault();
    if (!desgloseOk) return alert(`El desglose suma ${money(sumaDesglose)} y lo recibido es ${money(recibido)}: deben coincidir.`);
    const datos = {
      pagoId: pago.id,
      aprobar: true,
      montoRecibido: recibido,
      usarSaldoFavor: usar,
      faltante,
      excedente,
      nota,
      cargosExtra: sobra ? extras : [],
      revisadoRepetido: repetido ? revisado : undefined,
      desglose: desglose ? desglose.map((d) => ({ categoria: d.categoria, monto: Number(d.monto) || 0 })).filter((d) => d.monto > 0) : null,
    };
    if (await run(() => adminCall('validarPago', datos), 'Pago aprobado y recibo emitido; se notificó al residente')) {
      reloadUnidades();
      onDone();
    }
  }

  return (
    <Modal title={`Aprobar comprobante · ${etiqueta(pago.unidadId)}`} onClose={onClose}>
      <form className="form" onSubmit={aprobar}>
        <p className="small muted" style={{ margin: 0 }}>
          El residente indicó {money(pago.monto)}. Abre el comprobante y escribe el monto que realmente se recibió.
        </p>
        <div>
          <Archivo path={pago.comprobantePath} origen={{ model: 'Pago', id: pago.id }} label="Ver comprobante" />
        </div>
        {repetido && (
          <>
            <NotaRepetido pago={pago} etiqueta={etiqueta} />
            <label className="check">
              <input type="checkbox" required checked={revisado} onChange={(e) => setRevisado(e.target.checked)} />
              Revisé este comprobante personalmente y no es un pago que ya se haya aplicado
            </label>
          </>
        )}
        <Field label="Monto recibido según el comprobante">
          <input required type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Field>
        {favor > 0 && total > 0 && (
          <label className="check">
            <input type="checkbox" checked={usar} onChange={(e) => setUsar(e.target.checked)} />
            Usar el saldo a favor de la unidad (tiene {money(favor)})
          </label>
        )}

        <div className={`cuadre ${tono}`}>
          {cubre.length ? (
            cubre.map((c) => (
              <div key={c.id}>
                <span>{c.concepto}</span>
                <span>{money(c.monto)}</span>
              </div>
            ))
          ) : (
            <div>
              <span>Sin cargos seleccionados (pago a cuenta)</span>
              <span>{money(0)}</span>
            </div>
          )}
          <div>
            <span>Recibido</span>
            <span>{money(recibido)}</span>
          </div>
          {favorUsado > 0 && (
            <div>
              <span>Saldo a favor que se usa</span>
              <span>{money(favorUsado)}</span>
            </div>
          )}
          {abonado > 0 && (
            <div>
              <span>Abonado a otros cargos</span>
              <span>{money(abonado)}</span>
            </div>
          )}
          <div className="cuadre-res">
            <span>{resultado}</span>
            <span>{ajuste === 'COMPLETO' ? <Icon name="check" /> : money(dif)}</span>
          </div>
        </div>

        {sobra && otros.length > 0 && (
          <fieldset className="opciones-ajuste">
            <legend>
              Sobran {money(plan.diferencia)} y {etiqueta(pago.unidadId)} tiene otros cargos pendientes. ¿Abonar el excedente a estos cargos?
            </legend>
            {otros.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={extras.includes(c.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, c.id] : extras.filter((x) => x !== c.id))} />
                <span>
                  {c.concepto} · {money(c.monto)}
                  {parcialExtra?.cargo.id === c.id && <span className="muted"> (se abonan {money(parcialExtra.pagado)}; quedan pendientes {money(parcialExtra.pendiente)})</span>}
                  {pe?.sinCubrir.some((x) => x.id === c.id) && extras.includes(c.id) && <span className="muted"> (ya no alcanza)</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {diferencia < -0.004 && (
          <fieldset className="opciones-ajuste">
            <legend>¿Qué pasa con los {money(dif)} que faltan?</legend>
            <label className="check">
              <input type="radio" name="faltante" checked={faltante === 'PENDIENTE'} onChange={() => setFaltante('PENDIENTE')} />
              <span>
                <strong>Pago parcial:</strong> quedan pendientes {money(dif)} con el mismo vencimiento. Se avisa al residente que su pago fue por menos de lo
                que se le cargó.
              </span>
            </label>
            <label className="check">
              <input type="radio" name="faltante" checked={faltante === 'CONDONAR'} onChange={() => setFaltante('CONDONAR')} />
              <span>
                <strong>Condonar la diferencia:</strong> el cargo se da por pagado completo. Escribe el motivo.
              </span>
            </label>
          </fieldset>
        )}
        {diferencia > 0.004 && (
          <fieldset className="opciones-ajuste">
            <legend>¿Qué pasa con los {money(dif)} que {abonado ? 'todavía ' : ''}sobran?</legend>
            <label className="check">
              <input type="radio" name="excedente" checked={excedente === 'SALDO_FAVOR'} onChange={() => setExcedente('SALDO_FAVOR')} />
              <span>
                <strong>Saldo a favor:</strong> se guarda en la unidad y se descuenta de sus próximos pagos. Se le recuerda al residente su cargo y su saldo a
                favor.
              </span>
            </label>
            <label className="check">
              <input type="radio" name="excedente" checked={excedente === 'INGRESO'} onChange={() => setExcedente('INGRESO')} />
              <span>
                <strong>Otro ingreso del condominio:</strong> no queda saldo a favor.
              </span>
            </label>
          </fieldset>
        )}

        <Categorias
          cats={cats}
          residente={pago.categoriaResidente}
          automatico={automatico}
          desglose={desglose}
          setDesglose={setDesglose}
          abrir={abrirDesglose}
          recibido={recibido}
          suma={sumaDesglose}
        />

        <Field label={ajuste === 'CONDONADO' ? 'Motivo de la condonación (lo verá el residente)' : 'Nota para el residente (opcional)'}>
          <textarea rows={2} maxLength={500} required={ajuste === 'CONDONADO'} minLength={ajuste === 'CONDONADO' ? 5 : undefined} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Field>
        <button className="btn-app" disabled={busy || !(recibido > 0 || favorUsado > 0) || !desgloseOk}>
          <Icon name="check" />
          {busy ? 'Aprobando…' : 'Aprobar y emitir recibo'}
        </button>
      </form>
    </Modal>
  );
}

/** Suma las partes de un pago por categoría. */
function agrupar(partes: { categoria: string; monto: number }[]) {
  const m = new Map<string, number>();
  for (const x of partes) m.set(x.categoria, (m.get(x.categoria) ?? 0) + x.monto);
  return [...m].map(([categoria, monto]) => ({ categoria, monto: r2(monto) })).filter((x) => x.monto > 0);
}

type FilaDesglose = { categoria: string; monto: string };

/** Categoría del ingreso: la automática (cargos y fecha) o el desglose de la administración entre varias categorías. */
function Categorias({
  cats,
  residente,
  automatico,
  desglose,
  setDesglose,
  abrir,
  recibido,
  suma,
}: {
  cats: CategoriaIngreso[];
  residente?: string | null;
  automatico: { categoria: string; monto: number }[];
  desglose: FilaDesglose[] | null;
  setDesglose: (d: FilaDesglose[] | null) => void;
  abrir: () => void;
  recibido: number;
  suma: number;
}) {
  const indico = residente ? (QUE_PAGA_RESIDENTE.find((c) => c.key === residente)?.label ?? etiquetaCategoria(residente, cats)) : null;
  const cambia = (i: number, x: Partial<FilaDesglose>) => setDesglose(desglose!.map((d, k) => (k === i ? { ...d, ...x } : d)));
  const falta = r2(recibido - suma);
  const color = (key: string) => cats.find((c) => c.key === key)?.color;
  return (
    <fieldset className="opciones-ajuste">
      <legend>Categoría del ingreso</legend>
      {indico && (
        <p className="small" style={{ margin: 0 }}>
          El residente indicó: <strong>{indico}</strong>
        </p>
      )}
      {!desglose ? (
        <>
          <div className="cuadre info">
            {automatico.length ? (
              automatico.map((x) => (
                <div key={x.categoria}>
                  <span>
                    <span className="punto-cat" style={{ background: color(x.categoria) }} />
                    {etiquetaCategoria(x.categoria, cats)}
                  </span>
                  <span>{money(x.monto)}</span>
                </div>
              ))
            ) : (
              <div>
                <span>Sin monto recibido</span>
                <span>{money(0)}</span>
              </div>
            )}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Automático: la cuota del mes es cuota corriente y la de un mes ya pasado, recuperación de cartera vencida. Si un solo depósito cubre varias cosas (p. ej.
            cuota del mes + meses atrasados), desglósalo.
          </p>
          <div>
            <button type="button" className="btn-app sm secondary" onClick={abrir}>
              <Icon name="chart" />
              Desglosar
            </button>
          </div>
        </>
      ) : (
        <>
          {desglose.map((d, i) => (
            <div key={i} className="fila-desglose">
              <span className="punto-cat" style={{ background: color(d.categoria) }} />
              <select value={d.categoria} onChange={(e) => cambia(i, { categoria: e.target.value })} aria-label="Categoría">
                {cats.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={d.monto} onChange={(e) => cambia(i, { monto: e.target.value })} aria-label="Monto" />
              <button type="button" className="icon-btn" aria-label="Quitar" disabled={desglose.length === 1} onClick={() => setDesglose(desglose.filter((_, k) => k !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="linklike small"
              onClick={() =>
                setDesglose([...desglose, { categoria: cats.find((c) => !desglose.some((d) => d.categoria === c.key))?.key ?? 'OTRO', monto: falta > 0 ? String(falta) : '' }])
              }
            >
              <Icon name="plus" /> Agregar categoría
            </button>
            <span className="small" style={{ color: Math.abs(falta) < 0.01 ? 'var(--teal-dark)' : 'var(--danger)', fontWeight: 600 }}>
              Suma {money(suma)} de {money(recibido)}
              {Math.abs(falta) >= 0.01 && ` · ${falta > 0 ? `faltan ${money(falta)}` : `sobran ${money(-falta)}`}`}
            </span>
          </div>
          <div>
            <button type="button" className="linklike small" onClick={() => setDesglose(null)}>
              Volver a la categoría automática
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}

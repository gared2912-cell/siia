// Match automático: la administración sube el estado de cuenta del banco (Excel) y el sistema empareja cada depósito
// con su comprobante «Por aprobar» (shared/conciliacion.ts, lo decide admin-api). Las coincidencias seguras quedan
// marcadas; las dudosas, sin marcar y con el motivo. Al confirmar, admin-api vuelve a cruzar y aprueba cada una como
// «Pago completo» (folio, cargos, aviso y recibo al residente) y guarda el depósito para no volver a usarlo.
import { useState } from 'react';
import { adminCall, type Schema } from '../api';
import { Archivo, Empty, Icon, Modal, fecha, money } from '../ui';
import { useAdmin } from './AdminApp';
import type { Coincidencia, Conciliacion } from '../../../amplify/functions/shared/conciliacion';

type Pago = Schema['Pago']['type'];
type Paso = 'archivo' | 'resultado' | 'confirmar' | 'aprobando' | 'listo';
type Final = { aprobados: { clave: string; pagoId: string; folio: string | null }[]; errores: { clave: string; pagoId: string; motivo: string }[] };

const LOTE = 5;

/** Lee la hoja del estado de cuenta tal cual (números y textos); admin-api encuentra los encabezados. */
async function leerArchivo(file: File): Promise<unknown[][]> {
  if (file.size > 8 * 1024 * 1024) throw new Error('El archivo supera 8 MB.');
  const XLSX = await import('xlsx');
  let libro;
  try {
    libro = XLSX.read(await file.arrayBuffer(), { cellDates: false });
  } catch {
    throw new Error('No se pudo leer el archivo. Sube el Excel (.xlsx, .xls) o CSV que descargas de tu banco.');
  }
  const hojas = libro.SheetNames.map((n) => XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[n], { header: 1, raw: true, defval: '' }));
  // La hoja con los movimientos: la que tiene encabezado de abonos o depósitos (si no, la primera).
  const conAbonos = hojas.find((h) => h.slice(0, 30).some((r) => r.some((c) => /abono|dep[oó]sito|cr[eé]dito/i.test(String(c)))));
  return conAbonos ?? hojas[0] ?? [];
}

export function ConciliarPagos({ pagos, onClose, onDone }: { pagos: Pago[]; onClose: () => void; onDone: () => void }) {
  const { condo } = useAdmin();
  const [paso, setPaso] = useState<Paso>('archivo');
  const [archivo, setArchivo] = useState<{ nombre: string; filas: unknown[][] } | null>(null);
  const [res, setRes] = useState<Conciliacion | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0 });
  const [final, setFinal] = useState<Final | null>(null);
  const porId = new Map(pagos.map((p) => [p.id, p]));

  async function analizar(file: File) {
    setError('');
    setCargando(true);
    try {
      const filas = await leerArchivo(file);
      const r = await adminCall<Conciliacion>('finanzas.conciliar', { condominioId: condo!.id, filas });
      setArchivo({ nombre: file.name, filas });
      setRes(r);
      setSel(new Set(r.coincidencias.filter((c) => c.nivel === 'COINCIDE').map((c) => c.clave)));
      setPaso('resultado');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function aprobar() {
    const cola = [...sel];
    const out: Final = { aprobados: [], errores: [] };
    setProgreso({ hechos: 0, total: cola.length });
    setPaso('aprobando');
    let intentosSinAvance = 0;
    while (cola.length) {
      const lote = cola.splice(0, LOTE);
      try {
        const r = await adminCall<Final & { sinProcesar: string[] }>('finanzas.aprobarConciliacion', {
          condominioId: condo!.id,
          filas: archivo!.filas,
          archivo: archivo!.nombre,
          claves: lote,
        });
        out.aprobados.push(...r.aprobados);
        out.errores.push(...r.errores);
        cola.unshift(...r.sinProcesar);
        intentosSinAvance = r.aprobados.length || r.errores.length ? 0 : intentosSinAvance + 1;
        if (intentosSinAvance >= 3) {
          out.errores.push(...cola.splice(0).map((clave) => ({ clave, pagoId: clave, motivo: 'No se alcanzó a procesar. Intenta de nuevo.' })));
        }
      } catch (e) {
        // Error de red o del servidor: los de este lote se reportan y se sigue con los demás.
        out.errores.push(...lote.map((clave) => ({ clave, pagoId: clave, motivo: e instanceof Error ? e.message : 'Ocurrió un error.' })));
      }
      setProgreso({ hechos: out.aprobados.length + out.errores.length, total: sel.size });
    }
    setFinal(out);
    setPaso('listo');
  }

  const cerrar = () => (paso === 'listo' || final ? onDone() : onClose());
  if (paso === 'aprobando')
    return (
      <Modal title="Aprobando pagos" onClose={() => undefined}>
        <div className="stack">
          <p>
            Aprobando {progreso.hechos} de {progreso.total}… No cierres esta ventana.
          </p>
          <div className="conc-barra" role="progressbar" aria-valuemin={0} aria-valuemax={progreso.total} aria-valuenow={progreso.hechos}>
            <span style={{ width: `${progreso.total ? (progreso.hechos / progreso.total) * 100 : 0}%` }} />
          </div>
        </div>
      </Modal>
    );

  return (
    <Modal title="Match automático con el estado de cuenta" onClose={cerrar} wide>
      {paso === 'archivo' && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            Sube el estado de cuenta que descargas de tu banco (Excel o CSV). El sistema busca cada depósito, identifica la casa o departamento por el concepto, la
            clave de rastreo o el nombre de quien transfirió, y lo compara con los comprobantes por aprobar. <strong>Solo se proponen los de monto exacto.</strong>{' '}
            Si un comprobante cubre varios cargos (por ejemplo, cuota y proporcional) y se pagaron en depósitos separados, cada cargo se aprueba por su lado con su
            propio recibo.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Nada se aprueba hasta que lo confirmes. Un depósito solo puede aprobar un comprobante, y un depósito ya usado no se vuelve a usar en cargas
            posteriores.
          </p>
          <label className={`conc-subir${cargando ? ' ocupado' : ''}`}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              disabled={cargando}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) analizar(f);
              }}
            />
            <Icon name="upload" />
            <span>{cargando ? 'Analizando el estado de cuenta…' : 'Elegir estado de cuenta'}</span>
          </label>
          {error && <div className="alert error">{error}</div>}
        </div>
      )}

      {paso === 'resultado' && res && (
        <Resultado
          res={res}
          archivo={archivo!.nombre}
          porId={porId}
          sel={sel}
          setSel={setSel}
          otro={() => (setRes(null), setArchivo(null), setPaso('archivo'))}
          aprobar={() => setPaso('confirmar')}
        />
      )}

      {paso === 'confirmar' && res && (
        <Confirmar items={res.coincidencias.filter((c) => sel.has(c.clave))} volver={() => setPaso('resultado')} aprobar={aprobar} />
      )}

      {paso === 'listo' && final && res && <Listo final={final} res={res} terminar={onDone} />}
    </Modal>
  );
}

const fechaMov = (d: string, hora?: string) => `${fecha(d)}${hora ? ` · ${hora.slice(0, 5)}` : ''}`;

function Resultado({
  res,
  archivo,
  porId,
  sel,
  setSel,
  otro,
  aprobar,
}: {
  res: Conciliacion;
  archivo: string;
  porId: Map<string, Pago>;
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  otro: () => void;
  aprobar: () => void;
}) {
  const coinciden = res.coincidencias.filter((c) => c.nivel === 'COINCIDE');
  const revisar = res.coincidencias.filter((c) => c.nivel === 'REVISAR');
  const elegidos = res.coincidencias.filter((c) => sel.has(c.clave));
  const total = elegidos.reduce((s, c) => s + c.monto, 0);
  const cambiar = (id: string) => {
    const n = new Set(sel);
    n.has(id) ? n.delete(id) : n.add(id);
    setSel(n);
  };
  const todos = (lista: Coincidencia[], si: boolean) => {
    const n = new Set(sel);
    for (const c of lista) si ? n.add(c.clave) : n.delete(c.clave);
    setSel(n);
  };
  const { resumen } = res;
  return (
    <div className="stack conc">
      <div className="conc-archivo small muted">
        <Icon name="file" /> {archivo} · {resumen.depositos} depósito{resumen.depositos === 1 ? '' : 's'} por {money(resumen.total)}
        {resumen.desde && ` · del ${fecha(resumen.desde)} al ${fecha(resumen.hasta)}`}
        <button type="button" className="linklike" onClick={otro}>
          Cambiar archivo
        </button>
      </div>
      <div className="conc-resumen">
        <Cifra n={coinciden.length} label="Coinciden" tono="ok" />
        <Cifra n={revisar.length} label="Revisar" tono="warn" />
        <Cifra n={res.sinComprobante.length} label="Depósitos sin comprobante" tono="neutro" />
        <Cifra n={res.sinDeposito.length} label="Comprobantes sin depósito" tono="neutro" />
      </div>
      {resumen.yaConciliados > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          {resumen.yaConciliados} depósito{resumen.yaConciliados === 1 ? '' : 's'} de este archivo ya se usaron en un match anterior y no se toman en cuenta.
        </p>
      )}

      {!res.coincidencias.length && <Empty icon="inbox">Ningún depósito de este archivo coincide con los comprobantes por aprobar.</Empty>}

      {coinciden.length > 0 && (
        <section className="conc-seccion">
          <div className="conc-seccion-head">
            <h3>Coinciden con el estado de cuenta ({coinciden.length})</h3>
            <div className="row-actions">
              <button type="button" className="linklike" onClick={() => todos(coinciden, true)}>
                Seleccionar todos
              </button>
              <button type="button" className="linklike" onClick={() => todos(coinciden, false)}>
                Quitar todos
              </button>
            </div>
          </div>
          <p className="small muted">Monto exacto, se identificó la casa o departamento y la fecha coincide. Quedan seleccionados para aprobar.</p>
          <ul className="tarjetas">
            {coinciden.map((c) => (
              <ItemMatch key={c.clave} c={c} pago={porId.get(c.pagoId)} marcado={sel.has(c.clave)} cambiar={() => cambiar(c.clave)} />
            ))}
          </ul>
        </section>
      )}

      {revisar.length > 0 && (
        <section className="conc-seccion">
          <div className="conc-seccion-head">
            <h3>Revisar antes de aprobar ({revisar.length})</h3>
          </div>
          <p className="small muted">
            El monto coincide, pero hay algo que conviene revisar (lo ves en cada uno). No están seleccionados: márcalos solo si ya los revisaste.
          </p>
          <ul className="tarjetas">
            {revisar.map((c) => (
              <ItemMatch key={c.clave} c={c} pago={porId.get(c.pagoId)} marcado={sel.has(c.clave)} cambiar={() => cambiar(c.clave)} />
            ))}
          </ul>
        </section>
      )}

      {res.sinComprobante.length > 0 && (
        <details className="conc-seccion conc-plegable">
          <summary>
            <h3>Depósitos sin comprobante por aprobar ({res.sinComprobante.length})</h3>
          </summary>
          <p className="small muted">Llegaron al banco, pero no hay un comprobante por aprobar que coincida. Pídele el comprobante al residente o revísalo a mano.</p>
          <ul className="tarjetas">
            {res.sinComprobante.map((s) => (
              <li key={s.mov.id} className="tarjeta t-neutro">
                <div className="tarjeta-in">
                  <span className="tarjeta-main">
                    <strong className="tarjeta-titulo">
                      {s.etiqueta ?? 'Sin identificar'} · {money(s.mov.monto)}
                    </strong>
                    <span className="tarjeta-sub">
                      {fechaMov(s.mov.fecha, s.mov.hora)}
                      {s.mov.ordenante && ` · ${s.mov.ordenante}`} · «{s.mov.concepto}»
                    </span>
                    <span className="conc-nota">{s.motivo}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {res.sinDeposito.length > 0 && (
        <details className="conc-seccion conc-plegable">
          <summary>
            <h3>Comprobantes sin depósito en este archivo ({res.sinDeposito.length})</h3>
          </summary>
          <p className="small muted">Siguen en «Por aprobar». Puede que el depósito sea de otro periodo, que el monto no coincida o que el comprobante esté repetido.</p>
          <ul className="tarjetas">
            {res.sinDeposito.map((s) => (
              <li key={s.pagoId} className={`tarjeta ${/repetido/.test(s.motivo) ? 't-warn' : 't-neutro'}`}>
                <div className="tarjeta-in">
                  <span className="tarjeta-main">
                    <strong className="tarjeta-titulo">
                      {s.etiqueta} · {money(s.monto)}
                    </strong>
                    <span className="tarjeta-sub">Pagado el {fecha(s.fechaPago)}</span>
                    <span className="conc-nota">{s.motivo}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {res.coincidencias.length > 0 && (
        <div className="conc-pie">
          <span>
            <strong>{elegidos.length}</strong> seleccionado{elegidos.length === 1 ? '' : 's'} · <strong>{money(total)}</strong>
          </span>
          <button type="button" className="btn-app" disabled={!elegidos.length} onClick={aprobar}>
            <Icon name="check" />
            Aprobar pagos seleccionados
          </button>
        </div>
      )}
    </div>
  );
}

function Cifra({ n, label, tono }: { n: number; label: string; tono: 'ok' | 'warn' | 'neutro' }) {
  return (
    <div className={`conc-cifra c-${tono}`}>
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

function ItemMatch({ c, pago, marcado, cambiar }: { c: Coincidencia; pago?: Pago; marcado: boolean; cambiar: () => void }) {
  return (
    <li className={`tarjeta ${c.nivel === 'COINCIDE' ? 't-ok' : 't-warn'}${marcado ? ' conc-marcado' : ''}`}>
      <label className="tarjeta-in tocable conc-item">
        <input type="checkbox" checked={marcado} onChange={cambiar} aria-label={`Aprobar ${c.etiqueta} por ${money(c.monto)}`} />
        <span className="tarjeta-main">
          <strong className="tarjeta-titulo">
            {c.etiqueta} · {money(c.monto)}
          </strong>
          <span className="tarjeta-sub">
            <b>Banco:</b> {fechaMov(c.mov.fecha, c.mov.hora)}
            {c.mov.ordenante && ` · ${c.mov.ordenante}`}
            {c.mov.banco && ` (${c.mov.banco})`}
          </span>
          <span className="tarjeta-sub">
            <b>Concepto:</b> «{c.mov.concepto}»
          </span>
          <span className="tarjeta-sub">
            <b>Comprobante:</b> pagado el {fecha(c.fechaPago)}
            {c.montoComprobante != null && ` · declaró ${money(c.montoComprobante)} por varios cargos`}
          </span>
          {c.cargoIds && <span className="pill sm">Cargo por separado</span>}
          <span className="conc-razones">
            {c.razones.map((r) => (
              <span key={r} className="pill sm ok">
                {r}
              </span>
            ))}
          </span>
          {c.cubre && <span className="small">{c.cubre}</span>}
          {c.alertas.map((a) => (
            <span key={a} className="conc-alerta">
              <Icon name="alert" /> {a}
            </span>
          ))}
          {c.notas.map((n) => (
            <span key={n} className="conc-nota">
              {n}
            </span>
          ))}
        </span>
      </label>
      {pago?.comprobantePath && (
        <div className="conc-ver">
          <Archivo path={pago.comprobantePath} origen={{ model: 'Pago', id: c.pagoId }} label="Ver comprobante" />
        </div>
      )}
    </li>
  );
}

function Confirmar({ items, volver, aprobar }: { items: Coincidencia[]; volver: () => void; aprobar: () => void }) {
  const total = items.reduce((s, c) => s + c.monto, 0);
  const revisar = items.filter((c) => c.nivel === 'REVISAR').length;
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>
        ¿Aprobar {items.length === 1 ? 'este pago que coincide' : `estos ${items.length} pagos que coinciden`} con el estado de cuenta?
      </h3>
      <p style={{ margin: 0 }}>
        Total: <strong>{money(total)}</strong>. Cada pago se aprueba como pago completo con su folio de recibo, y a cada residente le llega el aviso de que su
        pago fue aprobado y que ya puede descargar su recibo.
      </p>
      {revisar > 0 && (
        <div className="alert">
          Incluiste {revisar} pago{revisar === 1 ? '' : 's'} marcado{revisar === 1 ? '' : 's'} para revisar. Asegúrate de haberlo{revisar === 1 ? '' : 's'} revisado.
        </div>
      )}
      <ul className="conc-lista">
        {items.map((c) => (
          <li key={c.clave}>
            <span>
              {c.etiqueta}
              {c.cargoIds ? ' · cargo por separado' : ''}
            </span>
            <span>{money(c.monto)}</span>
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ margin: 0 }}>
        Revisa bien antes de confirmar: un pago aprobado no se deshace desde aquí.
      </p>
      <div className="row-actions">
        <button type="button" className="btn-app" onClick={aprobar}>
          <Icon name="check" />
          Sí, aprobar {items.length} pago{items.length === 1 ? '' : 's'}
        </button>
        <button type="button" className="btn-app secondary" onClick={volver}>
          Regresar
        </button>
      </div>
    </div>
  );
}

function Listo({ final, res, terminar }: { final: Final; res: Conciliacion; terminar: () => void }) {
  const et = (clave: string) => res.coincidencias.find((c) => c.clave === clave) ?? res.coincidencias.find((c) => c.pagoId === clave);
  const total = final.aprobados.reduce((s, a) => s + (et(a.clave)?.monto ?? 0), 0);
  return (
    <div className="stack">
      {final.aprobados.length > 0 && (
        <div className="alert ok">
          Se aprobaron {final.aprobados.length} pago{final.aprobados.length === 1 ? '' : 's'} por {money(total)}. Cada residente ya recibió el aviso y puede descargar su
          recibo.
        </div>
      )}
      {final.errores.length > 0 && (
        <div className="alert error">
          {final.errores.length} no se aprobaron:
          <ul>
            {final.errores.map((e) => (
              <li key={e.clave}>
                {et(e.clave)?.etiqueta ?? 'Pago'} {et(e.clave) ? money(et(e.clave)!.monto) : ''}: {e.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {final.aprobados.length > 0 && (
        <ul className="conc-lista">
          {final.aprobados.map((a) => (
            <li key={a.clave}>
              <span>
                {et(a.clave)?.etiqueta} · recibo {a.folio ?? '—'}
              </span>
              <span>{money(et(a.clave)?.monto)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <button type="button" className="btn-app" onClick={terminar}>
          Terminar
        </button>
      </div>
    </div>
  );
}

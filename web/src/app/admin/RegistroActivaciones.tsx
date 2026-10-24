// Panel › Residentes › Registro de activaciones: cortes de accesos por morosidad para el técnico (ver
// amplify/functions/shared/cortes.ts). Cada corte se descarga en Excel y queda guardado; el siguiente corte da por
// hecho lo que quedó por desactivar o por activar.
import { useState } from 'react';
import { adminCall } from '../api';
import { Acciones, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, Tarjeta, TarjetaIcono, Tarjetas, fechaHora, money, useAction, useLoad } from '../ui';
import { MIN_CUOTAS_DEFECTO, textoCriterio, type Corte } from '../../../amplify/functions/shared/cortes';
import { useAdmin } from './AdminApp';

type Lista = { cortes: Corte[]; tipos: string[] };

export function RegistroActivaciones({ onBack, puedeCortar }: { onBack: () => void; puedeCortar: boolean }) {
  const { condo, firmaReporte } = useAdmin();
  const cid = condo!.id;
  const { data, error, loading, reload } = useLoad(() => adminCall<Lista>('cortes.lista', { condominioId: cid }), [cid]);
  const [nuevo, setNuevo] = useState(false);
  const { run, busy } = useAction();

  const descargar = (corte: Corte, previos: Corte[]) =>
    import('./excelCorte').then(({ descargarExcelCorte }) => descargarExcelCorte({ condominio: condo!.nombre, corte, previos, generadoPor: firmaReporte }));
  const volverADescargar = (c: Corte) =>
    run(async () => {
      const r = await adminCall<{ corte: Corte; previos: Corte[] }>('cortes.ver', { condominioId: cid, id: c.id });
      await descargar(r.corte, r.previos);
    }, `Corte #${c.numero} descargado`);

  const ultimo = data?.cortes[0];
  const [ficha, setFicha] = useState<string | null>(null);
  const fichaC = data?.cortes.find((c) => c.id === ficha);
  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onBack}>
          <Icon name="back" /> Residentes
        </button>
      </div>
      <PageHead icon="clock" title="Registro de activaciones" sub={`${condo!.nombre} · cortes de accesos por morosidad para el técnico`}>
        {puedeCortar && (
          <button className="btn-app" disabled={!data} onClick={() => setNuevo(true)}>
            <Icon name="download" />
            Hacer corte
          </button>
        )}
      </PageHead>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <>
          {ultimo && (ultimo.resumen.porDesactivar > 0 || ultimo.resumen.porActivar > 0) && (
            <div className="alert" role="status">
              <strong>Pendiente con el técnico (corte #{ultimo.numero}):</strong> {ultimo.resumen.porDesactivar} por desactivar y {ultimo.resumen.porActivar} por
              activar. Al hacer el siguiente corte se dan por hechos.
            </div>
          )}
          <section className="panel">
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Cortes</h2>
            {data!.cortes.length ? (
              <Tarjetas>
                {data!.cortes.map((c) => (
                  <Tarjeta
                    key={c.id}
                    tono={c === ultimo && (c.resumen.porDesactivar > 0 || c.resumen.porActivar > 0) ? 'warn' : 'neutro'}
                    onClick={() => setFicha(c.id)}
                    media={<TarjetaIcono name="clock" />}
                    titulo={`Corte #${c.numero} · ${fechaHora(c.fecha)}`}
                    sub={`${c.resumen.morosos} moroso(s) · ${money(c.resumen.monto)} · ${c.resumen.porDesactivar} por desactivar · ${c.resumen.porActivar} por activar`}
                  />
                ))}
              </Tarjetas>
            ) : (
              <Empty icon="clock">Aún no hay cortes. Con «Hacer corte» descargas la lista de morosos y de accesos por desactivar.</Empty>
            )}
          </section>
        </>
      )}

      {fichaC && (
        <Modal title={`Corte #${fichaC.numero}`} onClose={() => setFicha(null)}>
          <div className="stack">
            <Datos
              items={[
                ['Fecha', fechaHora(fichaC.fecha)],
                ['Morosos', String(fichaC.resumen.morosos)],
                ['Adeudo', money(fichaC.resumen.monto)],
                ['Por desactivar', String(fichaC.resumen.porDesactivar)],
                ['Por activar', String(fichaC.resumen.porActivar)],
                ['Desactivados', String(fichaC.resumen.desactivados)],
                ['Hizo el corte', fichaC.porNombre],
              ]}
            />
            <p className="small muted" style={{ margin: 0 }}>
              {textoCriterio(fichaC.criterio)}
            </p>
            <Acciones>
              <button type="button" className="btn-app secondary" disabled={busy} onClick={() => volverADescargar(fichaC)}>
                <Icon name="download" />
                Descargar Excel
              </button>
            </Acciones>
          </div>
        </Modal>
      )}
      {nuevo && data && (
        <NuevoCorte
          tipos={data.tipos}
          ultimo={ultimo}
          onClose={() => setNuevo(false)}
          onDone={async (r) => {
            setNuevo(false);
            reload(true);
            await descargar(r.corte, r.previos);
          }}
        />
      )}
    </div>
  );
}

function NuevoCorte({
  tipos,
  ultimo,
  onClose,
  onDone,
}: {
  tipos: string[];
  ultimo?: Corte;
  onClose: () => void;
  onDone: (r: { corte: Corte; previos: Corte[] }) => Promise<void>;
}) {
  const { condo } = useAdmin();
  // Por omisión, lo mismo que el corte anterior.
  const [elegidos, setElegidos] = useState<string[]>(ultimo?.criterio.tipos.filter((t) => tipos.includes(t)) ?? []);
  const [cuenta, setCuenta] = useState<'cuotas' | 'extras'>(ultimo?.criterio.extraordinarios ? 'extras' : 'cuotas');
  const [minCuotas, setMinCuotas] = useState(ultimo?.criterio.minCuotas ?? MIN_CUOTAS_DEFECTO);
  const { run, busy } = useAction();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    let r: { corte: Corte; previos: Corte[] } | undefined;
    const ok = await run(async () => {
      r = await adminCall('cortes.crear', { condominioId: condo!.id, tipos: elegidos, extraordinarios: cuenta === 'extras', minCuotas });
    });
    if (ok && r) await run(() => onDone(r!), `Corte #${r.corte.numero} listo y descargado`);
  }

  return (
    <Modal title="Hacer corte de accesos" onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Accesos que se desactivan a los morosos</span>
          {tipos.length ? (
            <div className="checks" style={{ marginTop: 6 }}>
              {tipos.map((t) => (
                <label key={t} className="check">
                  <input type="checkbox" checked={elegidos.includes(t)} onChange={() => setElegidos(elegidos.includes(t) ? elegidos.filter((x) => x !== t) : [...elegidos, t])} />
                  {t}
                </label>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              El condominio aún no tiene accesos registrados. El corte solo listará a los morosos.
            </p>
          )}
        </fieldset>
        <Field label="Para considerar moroso, contar">
          <Seg
            value={cuenta}
            onChange={setCuenta}
            options={[
              ['cuotas', 'Solo cuotas de mantenimiento'],
              ['extras', 'Cuotas y cargos extraordinarios'],
            ]}
          />
        </Field>
        <Field label="Es moroso a partir de" hint="Cuotas (o cargos) con la fecha límite vencida y sin pagar.">
          <select value={minCuotas} onChange={(e) => setMinCuotas(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} vencida{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="alert small">
          {ultimo ? (
            <>
              Lo que quedó <b>por desactivar</b> o <b>por activar</b> en el corte #{ultimo.numero} se da por hecho por el técnico y se actualiza en SIIA.{' '}
            </>
          ) : null}
          Los accesos marcados de cada moroso saldrán como <b>Por desactivar</b>; quien ya pagó y tenía accesos desactivados por morosidad saldrá como{' '}
          <b>Por activar</b>.
        </div>
        <button className="btn-app" disabled={busy}>
          <Icon name="download" />
          {busy ? 'Haciendo el corte…' : 'Hacer corte y descargar Excel'}
        </button>
      </form>
    </Modal>
  );
}

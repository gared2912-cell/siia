// Finanzas del condominio: balances mensuales que la administración compartió al cerrar cada mes. El residente elige el
// año y el mes (solo se activan los meses compartidos), ve el estado financiero y lo descarga en PDF.
import { useState } from 'react';
import { portal } from '../api';
import { EstadoFinancieroVista } from '../EstadoFinancieroVista';
import { estadoDe, nombreMesLargo, type EstadoFinanciero } from '../estadoFinanciero';
import { Empty, ErrorBox, Icon, Loading, Modal, PageHead, hoy, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function FinanzasCondominio(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<{ periodo: string; compartidoEn: string | null }[]>('finanzas.balances'));
  const actual = hoy().slice(0, 4);
  const [anio, setAnio] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<EstadoFinanciero | null>(null);
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const compartidos = new Set(data!.map((x) => x.periodo));
  // Años con balances compartidos y el año en curso
  const anios = [...new Set([actual, ...data!.map((x) => x.periodo.slice(0, 4))])].sort();
  const elegido = anio ?? (data!.length ? data![data!.length - 1].periodo.slice(0, 4) : actual);

  const abrir = (periodo: string) =>
    run(async () => {
      const r = await portal<{ periodo: string; datos: unknown }>('finanzas.balance', { periodo });
      const e = estadoDe(r.datos);
      if (!e) throw new Error('No se pudo leer el balance de ese mes.');
      setAbierto(e);
    });
  const descargar = (e: EstadoFinanciero) =>
    run(async () => {
      const { descargarEstadoPdf } = await import('../estadoFinancieroPdf');
      await descargarEstadoPdf(e);
    }, 'Estado financiero descargado');

  return (
    <div className="stack">
      <PageHead icon="chart" title="Finanzas del condominio" sub="Balance de cada mes que la administración comparte al cerrarlo: ingresos, egresos, estado de resultados y cobranza." />
      <section className="panel stack">
        <div className="ef-anios" role="tablist" aria-label="Año">
          {anios.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={a === elegido} className={`ef-anio${a === elegido ? ' on' : ''}`} onClick={() => setAnio(a)}>
              {a}
            </button>
          ))}
        </div>
        <div className="ef-meses">
          {MESES.map((m, i) => {
            const periodo = `${elegido}-${String(i + 1).padStart(2, '0')}`;
            const activo = compartidos.has(periodo);
            return (
              <button key={periodo} type="button" className={`ef-mes${activo ? ' on' : ''}`} disabled={!activo || busy} onClick={() => abrir(periodo)} title={activo ? `Ver el balance de ${m.toLowerCase()}` : 'Aún no disponible'}>
                <span>{m}</span>
                {activo ? <Icon name="chart" /> : <span className="small">Pendiente</span>}
              </button>
            );
          })}
        </div>
        {!data!.length && <Empty icon="chart">La administración aún no comparte balances. Te avisaremos cuando cierre el mes.</Empty>}
      </section>
      {abierto && (
        <Modal title={`Balance de ${nombreMesLargo(abierto.periodo).toLowerCase()}`} onClose={() => setAbierto(null)} wide>
          <div className="stack">
            <button className="btn-app block" disabled={busy} onClick={() => descargar(abierto)}>
              <Icon name="download" />
              {busy ? 'Generando…' : 'Descargar PDF'}
            </button>
            <EstadoFinancieroVista e={abierto} />
          </div>
        </Modal>
      )}
    </div>
  );
}

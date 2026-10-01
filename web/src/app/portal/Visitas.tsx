import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { portal } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, etiquetaEstado, fecha, fechaHora, hoy, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

export type Visita = {
  id: string;
  tipo: string;
  nombre: string;
  placas?: string;
  fecha: string;
  fechaFin?: string;
  codigo?: string;
  origen?: string;
  estado: string;
  entradaEn?: string;
  salidaEn?: string;
  notas?: string;
  vigente?: boolean;
};

const TIPOS: [string, string][] = [
  ['VISITA', 'Visita'],
  ['SERVICIO', 'Servicio (limpieza, jardinería…)'],
  ['PROVEEDOR', 'Proveedor / técnico'],
  ['PAQUETERIA', 'Paquetería'],
];

export function Visitas({ perfil }: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<Visita[]>('visitas.lista'));
  const [nueva, setNueva] = useState(false);
  const [pase, setPase] = useState<Visita | null>(null);
  const [filtro, setFiltro] = useState<'activas' | 'historial'>('activas');
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const hoyStr = hoy();
  const vigenteOFutura = (v: Visita) => v.estado !== 'CANCELADA' && v.estado !== 'DENTRO' && !!v.codigo && (v.fechaFin || v.fecha) >= hoyStr && (v.estado === 'PROGRAMADA' || !!v.vigente);
  const activas = data!.filter((v) => v.estado === 'DENTRO' || vigenteOFutura(v));
  const lista = filtro === 'activas' ? activas : data!.filter((v) => !activas.includes(v));

  const cancelar = (v: Visita) =>
    confirm(`¿Cancelar el pase de ${v.nombre}?`) &&
    run(() => portal('visitas.cancelar', { visitaId: v.id }).then(() => reload(true)), 'Pase cancelado');

  return (
    <div className="stack">
      <PageHead icon="qr" title="Visitas" sub="Genera pases con código QR; la caseta los escanea al llegar tu visita.">
        <button className="btn-app" onClick={() => setNueva(true)}>
          <Icon name="plus" />
          Nuevo pase
        </button>
      </PageHead>

      <Seg value={filtro} onChange={setFiltro} options={[['activas', `Vigentes (${activas.length})`], ['historial', 'Historial']]} />

      <section className="panel">
        {lista.length ? (
          <ul className="list">
            {lista.map((v) => (
              <li key={v.id}>
                <div className="tile-icon">
                  <Icon name={v.tipo === 'PAQUETERIA' ? 'package' : v.origen === 'CASETA' ? 'shield' : 'qr'} />
                </div>
                <div className="list-main">
                  <strong>{v.nombre}</strong> <Badge estado={v.estado} />
                  <div className="list-sub">
                    {TIPOS.find((t) => t[0] === v.tipo)?.[1].split(' (')[0]} · {fecha(v.fecha)}
                    {v.fechaFin && ` al ${fecha(v.fechaFin)}`}
                    {v.placas && ` · ${v.placas}`}
                    {v.origen === 'CASETA' && ' · Registrada en caseta'}
                  </div>
                  {(v.entradaEn || v.salidaEn) && (
                    <div className="list-sub">
                      {v.entradaEn && `Entrada ${fechaHora(v.entradaEn)}`} {v.salidaEn && `· Salida ${fechaHora(v.salidaEn)}`}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  {vigenteOFutura(v) && (
                    <button className="btn-app sm" onClick={() => setPase(v)}>
                      <Icon name="qr" />
                      Pase
                    </button>
                  )}
                  {v.origen !== 'CASETA' && vigenteOFutura(v) && (
                    <button className="btn-app sm danger" onClick={() => cancelar(v)}>
                      Cancelar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="qr">{filtro === 'activas' ? 'No tienes pases vigentes.' : 'Sin historial todavía.'}</Empty>
        )}
      </section>

      {nueva && (
        <NuevaVisita
          onClose={() => setNueva(false)}
          onDone={(v) => {
            setNueva(false);
            setPase(v);
            reload(true);
          }}
        />
      )}
      {pase && <Pase visita={pase} condominio={perfil.condominio!.nombre} onClose={() => setPase(null)} />}
    </div>
  );
}

function NuevaVisita({ onClose, onDone }: { onClose: () => void; onDone: (v: Visita) => void }) {
  const [f, setF] = useState({ tipo: 'VISITA', nombre: '', placas: '', fecha: hoy(), fechaFin: '', notas: '' });
  const [varios, setVarios] = useState(false);
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    let v: Visita | undefined;
    const okk = await run(async () => {
      v = await portal<Visita>('visitas.crear', { ...f, fechaFin: varios ? f.fechaFin : '' });
    }, 'Pase generado');
    if (okk && v) onDone(v);
  }

  return (
    <Modal title="Nuevo pase de acceso" onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <Field label="Tipo">
          <select value={f.tipo} onChange={set('tipo')}>
            {TIPOS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nombre de la visita o empresa">
          <input required maxLength={120} value={f.nombre} onChange={set('nombre')} />
        </Field>
        <div className="form-2">
          <Field label="Fecha">
            <input required type="date" min={hoy()} value={f.fecha} onChange={set('fecha')} />
          </Field>
          <Field label="Placas (opcional)">
            <input maxLength={20} value={f.placas} onChange={set('placas')} style={{ textTransform: 'uppercase' }} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={varios} onChange={(e) => setVarios(e.target.checked)} />
          Acceso por varios días (personal de servicio, obra…)
        </label>
        {varios && (
          <Field label="Vigente hasta" hint="Máximo 90 días.">
            <input required type="date" min={f.fecha} value={f.fechaFin} onChange={set('fechaFin')} />
          </Field>
        )}
        <Field label="Notas para caseta (opcional)">
          <textarea maxLength={500} value={f.notas} onChange={set('notas')} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Generando…' : 'Generar pase'}
        </button>
      </form>
    </Modal>
  );
}

export function Pase({ visita, condominio, onClose }: { visita: Visita; condominio: string; onClose: () => void }) {
  const [img, setImg] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(`SIIA:${visita.codigo}`, { width: 520, margin: 1, color: { dark: '#2f3450' } }).then(setImg);
  }, [visita.codigo]);
  const vigencia = `${fecha(visita.fecha)}${visita.fechaFin ? ` al ${fecha(visita.fechaFin)}` : ''}`;
  const texto = `Pase de acceso a ${condominio} para ${visita.nombre} (${vigencia}). Código: ${visita.codigo}. Muéstralo en caseta.`;

  async function compartir() {
    try {
      if (img && navigator.canShare) {
        const blob = await (await fetch(img)).blob();
        const file = new File([blob], `pase-${visita.codigo}.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: texto });
          return;
        }
      }
      if (navigator.share) {
        await navigator.share({ text: texto });
        return;
      }
    } catch {
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  }

  return (
    <Modal title="Pase de acceso" onClose={onClose}>
      <div className="qr-card">
        {img ? <img src={img} alt={`Código QR ${visita.codigo}`} /> : <div className="loading"><div className="spinner" /></div>}
        <div className="codigo" style={{ marginTop: 8 }}>
          {visita.codigo}
        </div>
        <p style={{ margin: '8px 0 2px' }}>
          <strong>{visita.nombre}</strong> · {etiquetaEstado(visita.tipo)}
        </p>
        <p className="small muted">
          {condominio} · {vigencia}
        </p>
        <div className="row-actions" style={{ justifyContent: 'center' }}>
          <button className="btn-app" onClick={compartir}>
            Compartir pase
          </button>
          {img && (
            <a className="btn-app secondary" href={img} download={`pase-${visita.codigo}.png`}>
              Descargar
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}

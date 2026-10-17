// Registro de vigilancia (caseta): cambio de turno con foto del guardia en la caseta y de la caseta limpia, equipo
// entregado y notas. Lo guardado no se edita; solo se agregan notas. La administración lo consulta en Visitas.
import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { comprimirImagen } from '../camara';
import { ElegirArchivo } from '../ElegirArchivo';
import { Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, fechaHora, useAction, useLoad } from '../ui';

export type Nota = { texto: string; en: string; por: string };
export type Turno = {
  id: string;
  entra: string;
  sale: string;
  registradoPor?: string;
  casetaLimpia?: boolean;
  equipo?: (string | null)[] | null;
  notas?: unknown;
  visitasDentro?: number | null;
  lugaresOcupados?: number | null;
  fotoGuardiaUrl?: string | null;
  fotoCasetaUrl?: string | null;
  createdAt: string;
};

export const EQUIPO_CASETA = ['Radio', 'Llaves de caseta', 'Celular de caseta', 'Linterna', 'Libreta de bitácora', 'Gafetes de visitante'];

export function notasDe(t: Turno): Nota[] {
  let v: unknown = t.notas;
  for (let k = 0; k < 2 && typeof v === 'string'; k++) {
    try {
      v = JSON.parse(v);
    } catch {
      v = [];
    }
  }
  return Array.isArray(v) ? (v as Nota[]) : [];
}

/** Un cambio de turno con sus fotos, equipo y notas (para la caseta y la administración). */
export function TarjetaTurno({ t, onNota }: { t: Turno; onNota?: () => void }) {
  const [foto, setFoto] = useState<string | null>(null);
  const notas = notasDe(t);
  return (
    <article className="turno">
      <div className="turno-cab">
        <div>
          <strong>{fechaHora(t.createdAt)}</strong>
          <div className="small">
            Recibe: <strong>{t.entra}</strong> · Entrega: <strong>{t.sale}</strong>
          </div>
        </div>
        {t.casetaLimpia && <span className="pill ok sm">Caseta limpia</span>}
      </div>
      <div className="turno-fotos">
        {[
          ['Guardia en caseta', t.fotoGuardiaUrl],
          ['Caseta limpia', t.fotoCasetaUrl],
        ].map(([titulo, url]) => (
          <figure key={titulo}>
            {url ? (
              <button type="button" className="chat-foto" onClick={() => setFoto(url)} aria-label={`Ver foto: ${titulo}`}>
                <img src={url} alt={titulo ?? ''} loading="lazy" />
              </button>
            ) : (
              <span className="photo-thumb" />
            )}
            <figcaption className="small muted">{titulo}</figcaption>
          </figure>
        ))}
      </div>
      <div className="small muted">
        {(t.equipo ?? []).filter(Boolean).length ? `Equipo entregado: ${(t.equipo ?? []).filter(Boolean).join(', ')}` : 'Sin equipo registrado'}
        {t.visitasDentro != null && ` · ${t.visitasDentro} visita(s) dentro`}
        {t.lugaresOcupados ? ` · ${t.lugaresOcupados} lugar(es) de estacionamiento ocupado(s)` : ''}
      </div>
      <div className="turno-notas">
        <strong className="small">Notas del turno</strong>
        {notas.length ? (
          <ul>
            {notas.map((n, i) => (
              <li key={i}>
                <div className="pre">{n.texto}</div>
                <div className="small muted">
                  {n.por} · {fechaHora(n.en)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Sin notas.
          </p>
        )}
        {onNota && (
          <button type="button" className="linklike" onClick={onNota}>
            <Icon name="plus" /> Agregar nota
          </button>
        )}
      </div>
      {foto && (
        <div className="foto-completa" role="dialog" aria-label="Foto" onClick={() => setFoto(null)}>
          <img src={foto} alt="Foto" />
          <button type="button" className="icon-btn" aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
      )}
    </article>
  );
}

export function RegistroVigilancia({ miNombre }: { miNombre: string }) {
  const turnos = useLoad(() => portal<Turno[]>('vigilancia.turnos'));
  const [cambio, setCambio] = useState(false);
  const [nota, setNota] = useState<Turno | null>(null);
  return (
    <div className="stack">
      <PageHead icon="shield" title="Registro de vigilancia" sub="Cambios de turno con evidencia y notas. Lo registrado no se puede editar.">
        <button className="btn-app" onClick={() => setCambio(true)}>
          <Icon name="refresh" />
          Cambio de turno
        </button>
      </PageHead>
      {turnos.loading && !turnos.data ? (
        <Loading />
      ) : turnos.error ? (
        <ErrorBox error={turnos.error} retry={turnos.reload} />
      ) : turnos.data!.length ? (
        turnos.data!.map((t) => <TarjetaTurno key={t.id} t={t} onNota={() => setNota(t)} />)
      ) : (
        <section className="panel">
          <Empty icon="shield">Aún no hay cambios de turno registrados.</Empty>
        </section>
      )}
      {cambio && <CambioTurno miNombre={miNombre} onClose={() => setCambio(false)} onDone={() => (setCambio(false), turnos.reload(true))} />}
      {nota && <AgregarNota t={nota} onClose={() => setNota(null)} onDone={() => (setNota(null), turnos.reload(true))} />}
    </div>
  );
}

/** Campo de foto: cámara o galería, con vista previa. */
function FotoEvidencia({ label, hint, foto, onFoto }: { label: string; hint: string; foto: File | null; onFoto: (f: File | null) => void }) {
  return (
    <Field grupo label={label} hint={hint}>
      <ElegirArchivo value={foto} onChange={(fs) => onFoto(fs[0] ?? null)} />
    </Field>
  );
}

function CambioTurno({ miNombre, onClose, onDone }: { miNombre: string; onClose: () => void; onDone: () => void }) {
  const [entra, setEntra] = useState(miNombre);
  const [sale, setSale] = useState('');
  const [fotoGuardia, setFotoGuardia] = useState<File | null>(null);
  const [fotoCaseta, setFotoCaseta] = useState<File | null>(null);
  const [limpia, setLimpia] = useState(false);
  const [equipo, setEquipo] = useState<string[]>([]);
  const [nota, setNota] = useState('');
  const { run, busy } = useAction();
  const listo = entra.trim() && sale.trim() && fotoGuardia && fotoCaseta && limpia;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('El cambio de turno no se podrá editar después; solo podrás agregar notas. ¿Guardar?')) return;
    const okk = await run(async () => {
      const [fotoGuardiaPath, fotoCasetaPath] = await Promise.all([
        subirArchivo(await comprimirImagen(fotoGuardia!), 'vigilancia'),
        subirArchivo(await comprimirImagen(fotoCaseta!), 'vigilancia'),
      ]);
      await portal('vigilancia.cambioTurno', { entra, sale, fotoGuardiaPath, fotoCasetaPath, casetaLimpia: limpia, equipo, nota });
    }, 'Cambio de turno registrado');
    if (okk) onDone();
  }

  return (
    <Modal title="Cambio de turno" onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label="Recibe el turno (llega)">
            <input required maxLength={120} value={entra} onChange={(e) => setEntra(e.target.value)} />
          </Field>
          <Field label="Entrega el turno (se va)">
            <input required maxLength={120} value={sale} onChange={(e) => setSale(e.target.value)} />
          </Field>
        </div>
        <FotoEvidencia label="Foto del guardia en la caseta" hint="Quien recibe el turno, en la caseta." foto={fotoGuardia} onFoto={setFotoGuardia} />
        <FotoEvidencia label="Foto de la caseta limpia" hint="Evidencia de que la caseta se entrega limpia y en orden." foto={fotoCaseta} onFoto={setFotoCaseta} />
        <label className="check">
          <input type="checkbox" checked={limpia} onChange={(e) => setLimpia(e.target.checked)} />
          Confirmo que la caseta se entrega limpia y en orden
        </label>
        <Field label="Equipo que se entrega">
          <div className="checks">
            {EQUIPO_CASETA.map((x) => (
              <label key={x} className="check">
                <input type="checkbox" checked={equipo.includes(x)} onChange={(e) => setEquipo(e.target.checked ? [...equipo, x] : equipo.filter((y) => y !== x))} />
                {x}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Notas / novedades del turno (opcional)" hint="Situaciones que deban quedar por escrito. Después podrás agregar más notas, pero no editar estas.">
          <textarea rows={4} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Field>
        <button className="btn-app" disabled={busy || !listo}>
          {busy ? 'Guardando…' : 'Registrar cambio de turno'}
        </button>
        {!listo && <p className="small muted" style={{ margin: 0 }}>Faltan: {[!sale.trim() && 'quien entrega', !fotoGuardia && 'foto del guardia', !fotoCaseta && 'foto de la caseta', !limpia && 'confirmar caseta limpia'].filter(Boolean).join(', ')}.</p>}
      </form>
    </Modal>
  );
}

function AgregarNota({ t, onClose, onDone }: { t: Turno; onClose: () => void; onDone: () => void }) {
  const [texto, setTexto] = useState('');
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('La nota no se podrá editar ni borrar. ¿Guardar?')) return;
    if (await run(() => portal('vigilancia.nota', { turnoId: t.id, texto }), 'Nota agregada')) onDone();
  }
  return (
    <Modal title={`Agregar nota · turno de ${t.entra}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <p className="small muted" style={{ margin: 0 }}>
          Turno registrado el {fechaHora(t.createdAt)}. Las notas anteriores no cambian.
        </p>
        <Field label="Nota">
          <textarea required rows={5} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
        <button className="btn-app" disabled={busy || !texto.trim()}>
          {busy ? 'Guardando…' : 'Guardar nota'}
        </button>
      </form>
    </Modal>
  );
}

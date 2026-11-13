// Mascota extraviada: ficha que ven vecinos y caseta (foto, señas, de qué casa es y quién la ha visto) con el
// botón «La vi» para avisar dónde la vieron. El aviso llega al dueño, a la administración y a la caseta.
import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { ElegirArchivo } from '../ElegirArchivo';
import { comprimirImagen } from '../camara';
import { Archivo, Badge, Datos, Field, Icon, Modal, TarjetaIcono, VerImagen, fechaHora, useAction } from '../ui';

export type Avistamiento = {
  id: string;
  en: string;
  quien: string;
  unidad: string;
  donde: string;
  nota?: string | null;
  fotoUrl?: string;
  fotoPath?: string | null;
};

export type Extraviada = {
  id: string;
  nombre: string;
  especie?: string;
  raza?: string;
  color?: string;
  notas?: string;
  unidad: string;
  fotoUrl?: string;
  extraviadaEn?: string;
  avistamientos?: Avistamiento[];
  /** Es mascota de quien la está viendo (no puede decir «La vi»). */
  mia?: boolean;
};

/** Avistamientos del extravío actual, del más reciente al más antiguo. En el panel, `mascotaId` pide la foto a admin-api. */
export function ListaAvistamientos({ lista, mascotaId }: { lista: Avistamiento[]; mascotaId?: string }) {
  const [foto, setFoto] = useState('');
  if (!lista.length) return <p className="small muted" style={{ margin: 0 }}>Nadie ha avisado que la vio todavía.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {lista.map((a) => (
        <div key={a.id} className="panel" style={{ padding: 12, margin: 0 }}>
          <div className="small muted">
            {fechaHora(a.en)} · {a.quien}
            {a.unidad && !a.quien.startsWith(a.unidad) ? ` (${a.unidad})` : ''}
          </div>
          <div>
            <strong>Dónde:</strong> {a.donde}
          </div>
          {a.nota && <div className="small">{a.nota}</div>}
          {mascotaId && a.fotoPath ? (
            <div style={{ marginTop: 8 }}>
              <Archivo path={a.fotoPath} origen={{ model: 'Mascota', id: mascotaId, avistamiento: a.id }} grande />
            </div>
          ) : (
            a.fotoUrl && (
              <button type="button" className="foto-grande" style={{ marginTop: 8 }} onClick={() => setFoto(a.fotoUrl!)} aria-label="Ver foto en pantalla completa">
                <img src={a.fotoUrl} alt={`Foto de quien la vio: ${a.donde}`} />
              </button>
            )
          )}
        </div>
      ))}
      {foto && <VerImagen src={foto} onClose={() => setFoto('')} />}
    </div>
  );
}

/** Ficha de la mascota extraviada con «La vi». `accion`: 'mascotas.vista' (vecino) o 'caseta.mascotaVista'. */
export function FichaExtraviada({
  m,
  accion,
  onClose,
  onDone,
}: {
  m: Extraviada;
  accion: 'mascotas.vista' | 'caseta.mascotaVista';
  onClose: () => void;
  onDone: () => void;
}) {
  const [grande, setGrande] = useState(false);
  const [reportar, setReportar] = useState(false);
  const [f, setF] = useState({ donde: '', nota: '' });
  const [foto, setFoto] = useState<File | null>(null);
  const { run, busy } = useAction();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      const fotoPath = foto ? await subirArchivo(await comprimirImagen(foto), 'mascotas') : undefined;
      await portal(accion, { mascotaId: m.id, donde: f.donde, nota: f.nota, fotoPath });
    }, '¡Gracias! Avisamos al dueño, a la administración y a la caseta.');
    if (ok) onDone();
  }

  return (
    <Modal title={`Se busca: ${m.nombre}`} onClose={onClose}>
      <div className="stack">
        {m.fotoUrl ? (
          <button type="button" className="foto-grande" onClick={() => setGrande(true)} aria-label="Ver foto en pantalla completa">
            <img src={m.fotoUrl} alt={m.nombre} />
          </button>
        ) : (
          <TarjetaIcono name="paw" />
        )}
        {grande && m.fotoUrl && <VerImagen src={m.fotoUrl} alt={m.nombre} onClose={() => setGrande(false)} />}
        <div className="row-actions">
          <Badge estado="RECHAZADO">Extraviada</Badge>
        </div>
        <Datos
          items={[
            ['Especie y raza', [m.especie, m.raza].filter(Boolean).join(' · ')],
            ['Color / señas', m.color],
            ['Es de', m.unidad],
            ['Se perdió', m.extraviadaEn ? fechaHora(m.extraviadaEn) : null],
            ['Notas', m.notas],
          ]}
        />
        <h3 style={{ margin: '4px 0 0' }}>Quién la ha visto</h3>
        <ListaAvistamientos lista={m.avistamientos ?? []} />
        {m.mia ? (
          <p className="small muted" style={{ margin: 0 }}>
            Es tu mascota. Cuando aparezca, márcala como «Ya apareció» en «Mis mascotas».
          </p>
        ) : reportar ? (
          <form className="form" onSubmit={enviar}>
            <Field label="¿Dónde la viste?">
              <input required maxLength={200} value={f.donde} onChange={(e) => setF({ ...f, donde: e.target.value })} placeholder="Ej. Junto a la alberca, hace 10 minutos" />
            </Field>
            <Field label="Algo más (opcional)">
              <textarea maxLength={500} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Ej. Iba hacia la salida, la tengo en mi casa…" />
            </Field>
            <Field grupo label="Foto (opcional)">
              <ElegirArchivo value={foto} onChange={(fs) => setFoto(fs[0] ?? null)} />
            </Field>
            <button className="btn-app block" disabled={busy}>
              {busy ? 'Enviando…' : 'Avisar que la vi'}
            </button>
          </form>
        ) : (
          <button className="btn-app block" onClick={() => setReportar(true)}>
            <Icon name="paw" />
            La vi
          </button>
        )}
      </div>
    </Modal>
  );
}

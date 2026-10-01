import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { Archivo, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, fecha, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

export type Mascota = {
  id: string;
  nombre: string;
  especie?: string;
  raza?: string;
  color?: string;
  fotoPath?: string;
  vacunaAntirrabica?: string;
  estado: string;
  extraviada?: boolean;
  notas?: string;
  unidad?: string;
  fotoUrl?: string;
};

export function Mascotas(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<{ mias: Mascota[]; extraviadas: Mascota[] }>('mascotas.lista'));
  const [nueva, setNueva] = useState(false);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { mias, extraviadas } = data!;

  const extraviada = (m: Mascota, v: boolean) =>
    run(
      () => portal('mascotas.extraviada', { mascotaId: m.id, extraviada: v }).then(() => reload(true)),
      v ? 'Reporte publicado para vecinos y caseta' : '¡Qué bueno que apareció!',
    );

  return (
    <div className="stack">
      <PageHead icon="paw" title="Mascota segura" sub="Registra a tus mascotas; si se extravían, vecinos y caseta te ayudan a encontrarlas.">
        <button className="btn-app" onClick={() => setNueva(true)}>
          <Icon name="plus" />
          Registrar mascota
        </button>
      </PageHead>

      {extraviadas.length > 0 && (
        <section className="panel" style={{ borderColor: '#f4d2cf' }}>
          <h2>Mascotas extraviadas en el condominio</h2>
          <ul className="list">
            {extraviadas.map((m) => (
              <li key={m.id}>
                {m.fotoUrl ? <img className="photo-thumb" src={m.fotoUrl} alt={m.nombre} /> : <span className="photo-thumb" />}
                <div className="list-main">
                  <strong>{m.nombre}</strong> <Badge estado="RECHAZADO">Extraviada</Badge>
                  <div className="list-sub">
                    {[m.especie, m.raza, m.color].filter(Boolean).join(' · ')} · {m.unidad}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Mis mascotas</h2>
        {mias.length ? (
          <ul className="list">
            {mias.map((m) => (
              <li key={m.id}>
                <Archivo path={m.fotoPath} thumb />
                <div className="list-main">
                  <strong>{m.nombre}</strong> <Badge estado={m.estado} /> {m.extraviada && <Badge estado="RECHAZADO">Extraviada</Badge>}
                  <div className="list-sub">{[m.especie, m.raza, m.color].filter(Boolean).join(' · ')}</div>
                  {m.vacunaAntirrabica && <div className="list-sub">Vacuna antirrábica: {fecha(m.vacunaAntirrabica)}</div>}
                </div>
                {m.estado === 'APROBADA' &&
                  (m.extraviada ? (
                    <button className="btn-app sm secondary" onClick={() => extraviada(m, false)}>
                      Ya apareció
                    </button>
                  ) : (
                    <button className="btn-app sm danger" onClick={() => confirm(`¿Reportar a ${m.nombre} como extraviada?`) && extraviada(m, true)}>
                      Reportar extravío
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="paw">Aún no registras mascotas. La administración valida cada registro.</Empty>
        )}
      </section>

      {nueva && (
        <NuevaMascota
          onClose={() => setNueva(false)}
          onDone={() => {
            setNueva(false);
            reload(true);
          }}
        />
      )}
    </div>
  );
}

function NuevaMascota({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ nombre: '', especie: 'Perro', raza: '', color: '', vacunaAntirrabica: '', notas: '' });
  const [foto, setFoto] = useState<File | null>(null);
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      const fotoPath = foto ? await subirArchivo(foto, 'mascotas') : undefined;
      await portal('mascotas.registrar', { ...f, fotoPath });
    }, 'Registro enviado; la administración lo validará.');
    if (okk) onDone();
  }

  return (
    <Modal title="Registrar mascota" onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <div className="form-2">
          <Field label="Nombre">
            <input required maxLength={60} value={f.nombre} onChange={set('nombre')} />
          </Field>
          <Field label="Especie">
            <select value={f.especie} onChange={set('especie')}>
              <option>Perro</option>
              <option>Gato</option>
              <option>Otro</option>
            </select>
          </Field>
          <Field label="Raza">
            <input maxLength={60} value={f.raza} onChange={set('raza')} />
          </Field>
          <Field label="Color / señas">
            <input maxLength={60} value={f.color} onChange={set('color')} />
          </Field>
        </div>
        <Field label="Última vacuna antirrábica">
          <input type="date" value={f.vacunaAntirrabica} onChange={set('vacunaAntirrabica')} />
        </Field>
        <Field label="Foto">
          <input type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Notas (opcional)">
          <textarea maxLength={500} value={f.notas} onChange={set('notas')} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar registro'}
        </button>
      </form>
    </Modal>
  );
}

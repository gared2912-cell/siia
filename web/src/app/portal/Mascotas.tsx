import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { ElegirArchivo } from '../ElegirArchivo';
import { Acciones, Archivo, Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tarjeta, TarjetaIcono, Tarjetas, fecha, tonoDe, useAction, useLoad } from '../ui';
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
  const [ficha, setFicha] = useState<Mascota | null>(null);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { mias, extraviadas } = data!;

  const extraviada = (m: Mascota, v: boolean) =>
    run(
      () => portal('mascotas.extraviada', { mascotaId: m.id, extraviada: v }).then(() => (setFicha(null), reload(true))),
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
          <Tarjetas>
            {extraviadas.map((m) => (
              <Tarjeta
                key={m.id}
                tono="mal"
                media={m.fotoUrl ? <img className="photo-thumb" src={m.fotoUrl} alt={m.nombre} /> : <TarjetaIcono name="paw" />}
                titulo={m.nombre}
                sub={`${[m.especie, m.raza, m.color].filter(Boolean).join(' · ')} · ${m.unidad}`}
                lado={<Badge estado="RECHAZADO">Extraviada</Badge>}
              />
            ))}
          </Tarjetas>
        </section>
      )}

      <section className="panel">
        <h2>Mis mascotas</h2>
        {mias.length ? (
          <Tarjetas>
            {mias.map((m) => (
              <Tarjeta
                key={m.id}
                tono={m.extraviada ? 'mal' : tonoDe(m.estado)}
                onClick={() => setFicha(m)}
                media={m.fotoPath ? <Archivo path={m.fotoPath} thumb /> : <TarjetaIcono name="paw" />}
                titulo={m.nombre}
                sub={[m.especie, m.raza, m.color].filter(Boolean).join(' · ')}
                lado={
                  <>
                    <Badge estado={m.estado} />
                    {m.extraviada && <Badge estado="RECHAZADO">Extraviada</Badge>}
                  </>
                }
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="paw">Aún no registras mascotas. La administración valida cada registro.</Empty>
        )}
      </section>

      {ficha && (
        <Modal title={ficha.nombre} onClose={() => setFicha(null)}>
          <div className="stack">
            {ficha.fotoPath && <Archivo path={ficha.fotoPath} grande />}
            <div className="row-actions">
              <Badge estado={ficha.estado} />
              {ficha.extraviada && <Badge estado="RECHAZADO">Extraviada</Badge>}
            </div>
            <Datos
              items={[
                ['Especie y raza', [ficha.especie, ficha.raza].filter(Boolean).join(' · ')],
                ['Color', ficha.color],
                ['Vacuna antirrábica', ficha.vacunaAntirrabica ? fecha(ficha.vacunaAntirrabica) : null],
                ['Notas', ficha.notas],
              ]}
            />
            {ficha.estado === 'PENDIENTE' && <p className="small muted" style={{ margin: 0 }}>La administración está validando el registro.</p>}
            {ficha.estado === 'APROBADA' && (
              <Acciones>
                {ficha.extraviada ? (
                  <button className="btn-app" onClick={() => extraviada(ficha, false)}>
                    <Icon name="check" />
                    Ya apareció
                  </button>
                ) : (
                  <button className="btn-app danger" onClick={() => confirm(`¿Reportar a ${ficha.nombre} como extraviada?`) && extraviada(ficha, true)}>
                    Reportar extravío
                  </button>
                )}
              </Acciones>
            )}
          </div>
        </Modal>
      )}
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
        <Field grupo label="Foto">
          <ElegirArchivo value={foto} onChange={(fs) => setFoto(fs[0] ?? null)} />
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

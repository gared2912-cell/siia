// Condominios › Datos generales › Sonidos del beagle (solo superadministrador). El beagle del semáforo de pendientes
// no hace nada en verde, ladra en amarillo y gruñe en rojo, cada cierto tiempo, en el panel de los administradores.
import { useState } from 'react';
import { adminCall } from '../api';
import { Field, Icon, useAction, useToast } from '../ui';
import { useAdmin } from './AdminApp';
import { Beagle } from './Semaforo';
import { sonar } from './sonidosBeagle';
import { FRECUENCIAS_BEAGLE, VOLUMENES_BEAGLE, configBeagle, type ConfigBeagle } from '../../../amplify/functions/shared/beagle';

export function BeagleConfig() {
  const { condo, reloadCondos } = useAdmin();
  const inicial = configBeagle(condo?.beagleSonidos);
  const [f, setF] = useState<ConfigBeagle>(inicial);
  const { run, busy } = useAction();
  const toast = useToast();
  const cambio = f.activo !== inicial.activo || f.cadaMin !== inicial.cadaMin || f.volumen !== inicial.volumen;

  const probar = async (tipo: 'ladrido' | 'grunido') => {
    if (!(await sonar(tipo, f.volumen))) toast('Tu navegador no permitió reproducir el sonido. Revisa que no esté silenciado.', true);
  };
  const guardar = () =>
    run(
      () => adminCall('condominios.beagle', { condominioId: condo!.id, ...f }).then(() => reloadCondos()),
      'Sonidos del beagle guardados',
    );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: '1.1rem' }}>Sonidos del beagle</h2>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        El beagle del semáforo de pendientes avisa con un sonido suave a los administradores de este condominio. Solo el superadministrador cambia esta
        configuración.
      </p>
      <ul className="beagle-reglas">
        <li>
          <Beagle luz="verde" size={36} />
          <span>
            <strong>Verde</strong> (hasta 5 pendientes): no hace nada.
          </span>
        </li>
        <li>
          <Beagle luz="amarillo" size={36} />
          <span>
            <strong>Amarillo</strong> (más de 5): ladra.
          </span>
          <button type="button" className="btn-app sm secondary" onClick={() => probar('ladrido')}>
            <Icon name="bell" />
            Probar ladrido
          </button>
        </li>
        <li>
          <Beagle luz="rojo" size={36} />
          <span>
            <strong>Rojo</strong> (más de 10): gruñe.
          </span>
          <button type="button" className="btn-app sm secondary" onClick={() => probar('grunido')}>
            <Icon name="bell" />
            Probar gruñido
          </button>
        </li>
      </ul>
      <div className="stack">
        <label className="check">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
          Activar los sonidos del beagle
        </label>
        <div className="grid-2">
          <Field label="Cada cuánto suena" hint="Mientras el semáforo siga en amarillo o rojo.">
            <select className="input" value={f.cadaMin} disabled={!f.activo} onChange={(e) => setF({ ...f, cadaMin: Number(e.target.value) })}>
              {FRECUENCIAS_BEAGLE.map(([m, l]) => (
                <option key={m} value={m}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Volumen">
            <select className="input" value={f.volumen} disabled={!f.activo} onChange={(e) => setF({ ...f, volumen: e.target.value as ConfigBeagle['volumen'] })}>
              {VOLUMENES_BEAGLE.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row-actions">
          <button type="button" className="btn-app" disabled={busy || !cambio} onClick={guardar}>
            Guardar
          </button>
        </div>
      </div>
    </section>
  );
}

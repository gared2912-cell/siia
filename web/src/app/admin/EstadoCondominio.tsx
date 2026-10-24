// Suspender, eliminar y restaurar condominios (solo superadministrador; ver amplify/functions/shared/condominios.ts).
// - Suspendido: residentes, caseta y administradores de ese condominio no entran; no corren cuotas ni recargos automáticos.
// - Eliminado: va a la papelera 30 días (oculto para todos, cuentas desactivadas) y después se borra todo.
import { useState } from 'react';
import { adminCall } from '../api';
import { Acciones, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tarjeta, TarjetaIcono, Tarjetas, fecha, fechaHora, useAction, useLoad, useToast } from '../ui';
import { DIAS_PAPELERA, jsonDe } from '../../../amplify/functions/shared/condominios';
import { useAdmin, type Condominio } from './AdminApp';

type Suspension = { motivo?: string; en?: string; por?: string; porNombre?: string };
const suspensionDe = (c: Condominio) => jsonDe<Suspension>(c.suspension) ?? {};

/** Aviso en la ficha y en las secciones del condominio suspendido. */
export function AvisoSuspendido({ c }: { c: Condominio }) {
  const { superadmin } = useAdmin();
  const s = suspensionDe(c);
  return (
    <div className="alert error" role="status">
      <strong>Condominio suspendido</strong>
      {s.en && <> desde el {fecha(s.en)}</>}.{' '}
      {superadmin
        ? 'Sus residentes, la caseta y sus administradores no pueden entrar, y no se generan cuotas ni recargos automáticos.'
        : 'Por ahora no se puede administrar. Comunícate con SIIA.'}
      {superadmin && s.motivo && (
        <>
          <br />
          Motivo: {s.motivo}
          {s.porNombre && ` · ${s.porNombre}`}
        </>
      )}
    </div>
  );
}

/** Ficha › Datos generales: suspender / reactivar y enviar a la papelera (solo superadministrador). */
export function ZonaCondominio({ onEliminado }: { onEliminado: () => void }) {
  const { condo, reloadCondos } = useAdmin();
  const c = condo!;
  const { run, busy } = useAction();
  const [dialogo, setDialogo] = useState<'suspender' | 'eliminar' | null>(null);

  async function reactivar() {
    if (!confirm(`¿Reactivar ${c.nombre}? Sus residentes, la caseta y sus administradores vuelven a entrar.`)) return;
    if (await run(() => adminCall('condominios.reactivar', { condominioId: c.id }), `${c.nombre} está activo de nuevo.`)) reloadCondos();
  }

  return (
    <section className="panel">
      <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Suspender o eliminar</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Solo los superadministradores ven estas opciones.
      </p>
      <ul className="list">
        <li>
          <div className="list-main">
            <strong>{c.suspendido ? 'Reactivar condominio' : 'Suspender condominio'}</strong>
            <div className="list-sub">
              {c.suspendido
                ? 'Vuelven a entrar sus residentes, la caseta y sus administradores.'
                : 'Nadie de este condominio entra (residentes, caseta ni sus administradores) y se pausan las cuotas y recargos automáticos. Los datos se conservan.'}
            </div>
          </div>
          {c.suspendido ? (
            <button type="button" className="btn-app sm" disabled={busy} onClick={reactivar}>
              <Icon name="refresh" />
              Reactivar
            </button>
          ) : (
            <button type="button" className="btn-app sm secondary" disabled={busy} onClick={() => setDialogo('suspender')}>
              <Icon name="pause" />
              Suspender
            </button>
          )}
        </li>
        <li>
          <div className="list-main">
            <strong>Eliminar condominio</strong>
            <div className="list-sub">
              Desaparece para todos y se desactivan las cuentas de sus residentes y caseta. Queda {DIAS_PAPELERA} días en la papelera por si fue un error; después se
              borra todo de forma definitiva.
            </div>
          </div>
          <button type="button" className="btn-app sm danger" disabled={busy} onClick={() => setDialogo('eliminar')}>
            <Icon name="trash" />
            Eliminar
          </button>
        </li>
      </ul>
      {dialogo === 'suspender' && <Suspender c={c} onClose={() => setDialogo(null)} onDone={() => (setDialogo(null), reloadCondos())} />}
      {dialogo === 'eliminar' && (
        <Confirmar
          titulo="Eliminar condominio"
          nombre={c.nombre}
          boton="Enviar a la papelera"
          onClose={() => setDialogo(null)}
          accion={(confirmacion) => adminCall<{ borraEl: string }>('condominios.eliminar', { condominioId: c.id, confirmacion })}
          exito={(r) => `${c.nombre} está en la papelera. Se borra definitivamente el ${fecha(r.borraEl)}.`}
          onDone={() => {
            setDialogo(null);
            onEliminado();
            reloadCondos();
          }}
        >
          <p style={{ marginTop: 0 }}>
            <strong>{c.nombre}</strong> desaparece para todos los administradores, y sus residentes y caseta ya no pueden entrar.
          </p>
          <p>
            Queda {DIAS_PAPELERA} días en la papelera (Condominios › Papelera), donde puedes restaurarlo. Después se borran de forma definitiva sus unidades,
            residentes, cuentas de acceso, pagos, archivos y todo su historial.
          </p>
        </Confirmar>
      )}
    </section>
  );
}

function Suspender({ c, onClose, onDone }: { c: Condominio; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('');
  const { run, busy } = useAction();
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => adminCall('condominios.suspender', { condominioId: c.id, motivo }), `${c.nombre} quedó suspendido.`)) onDone();
  }
  return (
    <Modal title="Suspender condominio" onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <p style={{ margin: 0 }}>
          Mientras <strong>{c.nombre}</strong> esté suspendido, sus residentes, la caseta y sus administradores no pueden entrar, y no se generan cuotas ni
          recargos automáticos. No se borra nada; lo reactivas cuando quieras.
        </p>
        <Field label="Motivo" hint="Solo lo ven los superadministradores.">
          <textarea required rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Falta de pago del servicio" />
        </Field>
        <button className="btn-app" disabled={busy || !motivo.trim()}>
          {busy ? 'Suspendiendo…' : 'Suspender condominio'}
        </button>
      </form>
    </Modal>
  );
}

/** Confirmación fuerte: hay que escribir el nombre del condominio. */
function Confirmar<T>({
  titulo,
  nombre,
  boton,
  children,
  accion,
  exito,
  onClose,
  onDone,
}: {
  titulo: string;
  nombre: string;
  boton: string;
  children: React.ReactNode;
  accion: (confirmacion: string) => Promise<T>;
  exito: (r: T) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [texto, setTexto] = useState('');
  const { run, busy } = useAction();
  const toast = useToast();
  const coincide = texto.trim().replace(/\s+/g, ' ').toLowerCase() === nombre.trim().replace(/\s+/g, ' ').toLowerCase();
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    let r: T | undefined;
    const okk = await run(async () => {
      r = await accion(texto);
    });
    if (okk && r !== undefined) {
      onDone();
      // El aviso de éxito depende de la respuesta (p. ej. la fecha de borrado).
      toast(exito(r));
    }
  }
  return (
    <Modal title={titulo} onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        <div>{children}</div>
        <Field label={`Para confirmar, escribe el nombre del condominio: ${nombre}`}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </Field>
        <button className="btn-app danger" disabled={busy || !coincide}>
          <Icon name="trash" />
          {busy ? 'Un momento…' : boton}
        </button>
      </form>
    </Modal>
  );
}

type EnPapelera = {
  id: string;
  nombre: string;
  tipo: string | null;
  eliminadoEn: string;
  borraEl: string;
  porNombre: string | null;
  por: string | null;
  purgando: boolean;
  unidades: number;
  cuentas: number;
};

/** Condominios › Papelera: restaurar o borrar definitivamente sin esperar los 30 días. */
export function Papelera({ onBack }: { onBack: () => void }) {
  const { reloadCondos } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => adminCall<EnPapelera[]>('condominios.papelera'));
  const { run, busy } = useAction();
  const [borrar, setBorrar] = useState<EnPapelera | null>(null);
  const [ficha, setFicha] = useState<EnPapelera | null>(null);

  async function restaurar(c: EnPapelera) {
    if (!confirm(`¿Restaurar ${c.nombre}? Vuelve a aparecer con todos sus datos y sus residentes y caseta recuperan el acceso con su misma contraseña.`)) return;
    const ok = await run(() => adminCall('condominios.restaurar', { condominioId: c.id }), `${c.nombre} se restauró.`);
    if (ok) {
      reload(true);
      reloadCondos();
    }
  }

  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onBack}>
          <Icon name="back" /> Todos los condominios
        </button>
      </div>
      <PageHead
        icon="trash"
        title="Papelera"
        sub={`Condominios eliminados. Se borran de forma definitiva ${DIAS_PAPELERA} días después de eliminarlos; mientras tanto puedes restaurarlos.`}
      />
      <section className="panel">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} retry={reload} />
        ) : data?.length ? (
          <Tarjetas>
            {data.map((c) => (
              <Tarjeta
                key={c.id}
                tono="mal"
                onClick={() => setFicha(c)}
                media={<TarjetaIcono name="building" />}
                titulo={c.nombre}
                sub={`Eliminado el ${fechaHora(c.eliminadoEn)}${c.porNombre ? ` por ${c.porNombre}` : ''}`}
                lado={c.purgando ? <strong className="small">Borrándose…</strong> : <span className="small muted">Se borra el {fecha(c.borraEl)}</span>}
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="trash">La papelera está vacía.</Empty>
        )}
      </section>
      {ficha && (
        <Modal title={ficha.nombre} onClose={() => setFicha(null)}>
          <div className="stack">
            <Datos
              items={[
                ['Unidades', String(ficha.unidades)],
                ['Cuentas de residentes y caseta', String(ficha.cuentas)],
                ['Eliminado', `${fechaHora(ficha.eliminadoEn)}${ficha.porNombre ? ` por ${ficha.porNombre}` : ''}`],
                ['Se borra definitivamente', ficha.purgando ? 'Borrándose en este momento…' : fecha(ficha.borraEl)],
              ]}
            />
            {!ficha.purgando && (
              <Acciones>
                <button type="button" className="btn-app" disabled={busy} onClick={() => (setFicha(null), restaurar(ficha))}>
                  <Icon name="refresh" />
                  Restaurar
                </button>
                <button type="button" className="btn-app danger" disabled={busy} onClick={() => (setBorrar(ficha), setFicha(null))}>
                  <Icon name="trash" />
                  Borrar ya
                </button>
              </Acciones>
            )}
          </div>
        </Modal>
      )}
      {borrar && (
        <Confirmar
          titulo="Borrar definitivamente"
          nombre={borrar.nombre}
          boton="Borrar definitivamente"
          onClose={() => setBorrar(null)}
          accion={(confirmacion) => adminCall('condominios.borrarDefinitivo', { condominioId: borrar.id, confirmacion })}
          exito={() => `${borrar.nombre} se está borrando definitivamente.`}
          onDone={() => {
            setBorrar(null);
            reload(true);
          }}
        >
          <p style={{ marginTop: 0 }}>
            Se borran en este momento, <strong>sin posibilidad de recuperarlos</strong>, las {borrar.unidades} unidades de <strong>{borrar.nombre}</strong>, las{' '}
            {borrar.cuentas} cuentas de sus residentes y caseta, sus pagos, archivos y todo su historial.
          </p>
        </Confirmar>
      )}
    </div>
  );
}

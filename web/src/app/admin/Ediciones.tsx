// Ediciones con motivo en Finanzas (ver amplify/functions/shared/ediciones.ts): el motivo que se pide al editar,
// cancelar o eliminar, y el historial de cambios de cada registro (quién, cuándo, por qué y qué cambió).
import { useState } from 'react';
import { Field, Modal, money, useAction } from '../ui';
import { useAdmin } from './AdminApp';
import { CAMPOS_EDICION, MOTIVOS_EDICION, edicionesDe, etiquetaMotivo } from '../../../amplify/functions/shared/ediciones';

export type Motivo = { motivo: string; detalle: string };
export const motivoVacio: Motivo = { motivo: '', detalle: '' };

/** ¿El administrador ya no puede modificarlo? (ya fue editado y no es superadministrador) */
export function useBloqueoEdicion() {
  const { superadmin } = useAdmin();
  return (item: { ediciones?: unknown } | null | undefined) => !superadmin && edicionesDe(item?.ediciones).length > 0;
}

export const AVISO_BLOQUEO = 'Ya fue editado: solo un superadministrador puede volver a modificarlo.';

/** Motivo del cambio (obligatorio) y su descripción (obligatoria con «Otro»). */
export function CamposMotivo({ value, onChange }: { value: Motivo; onChange: (m: Motivo) => void }) {
  const otro = value.motivo === 'OTRO';
  return (
    <>
      <Field label="Motivo del cambio">
        <select required value={value.motivo} onChange={(e) => onChange({ ...value, motivo: e.target.value })}>
          <option value="">Selecciona…</option>
          {MOTIVOS_EDICION.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={otro ? '¿Por qué? Describe el motivo' : 'Descripción (opcional)'} hint="Queda en el historial con tu nombre, la fecha y la hora.">
        <textarea
          rows={2}
          required={otro}
          minLength={otro ? 5 : undefined}
          maxLength={500}
          value={value.detalle}
          onChange={(e) => onChange({ ...value, detalle: e.target.value })}
          placeholder={otro ? 'Ej. El residente pagó parte en efectivo en la oficina' : 'Ej. Se capturó $1,500 en lugar de $1,050'}
        />
      </Field>
    </>
  );
}

/** Ventana que solo pide el motivo (cancelar o eliminar). */
export function PedirMotivo({
  titulo,
  texto,
  boton,
  peligro,
  onClose,
  onConfirmar,
}: {
  titulo: string;
  texto: React.ReactNode;
  boton: string;
  peligro?: boolean;
  onClose: () => void;
  onConfirmar: (m: Motivo) => Promise<unknown>;
}) {
  const [m, setM] = useState<Motivo>(motivoVacio);
  const { run, busy } = useAction();
  return (
    <Modal title={titulo} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => onConfirmar(m))) onClose();
        }}
      >
        <p style={{ margin: 0 }}>{texto}</p>
        <CamposMotivo value={m} onChange={setM} />
        <button className={`btn-app${peligro ? ' danger' : ''}`} disabled={busy}>
          {busy ? 'Guardando…' : boton}
        </button>
      </form>
    </Modal>
  );
}

const fechaHora = (d: string) => new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ACCION: Record<string, string> = { EDITAR: 'Editado', CANCELAR: 'Cancelado', ELIMINAR: 'Eliminado' };
const ESTADOS: Record<string, string> = { PENDIENTE: 'Pendiente', PAGADO: 'Pagado', CANCELADO: 'Cancelado' };

function valor(campo: string, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'monto' || campo === 'saldoInicial') return money(Number(v));
  if (campo === 'vence' || campo === 'fecha') return new Date(`${v}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  if (campo === 'estado') return ESTADOS[String(v)] ?? String(v);
  return String(v);
}

/** Historial de cambios con motivo; nadie lo puede modificar. */
export function HistorialEdiciones({ item }: { item: { ediciones?: unknown } }) {
  const lista = edicionesDe(item.ediciones);
  if (!lista.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="acciones-titulo">Historial de cambios</span>
      {[...lista].reverse().map((e, i) => (
        <div key={i} className="alert small" style={{ margin: 0 }}>
          <div>
            <strong>{ACCION[e.accion] ?? 'Editado'}</strong> por {e.por?.nombre}
            {e.por?.rol === 'SUPERADMIN' ? ' (Superadmin)' : ''}
            {e.por?.email ? ` · ${e.por.email}` : ''} · {fechaHora(e.en)}
          </div>
          <div>
            <strong>Motivo:</strong> {etiquetaMotivo(e.motivo)}
            {e.detalle ? ` — ${e.detalle}` : ''}
          </div>
          {e.cambios.map((c) => (
            <div key={c.campo}>
              {CAMPOS_EDICION[c.campo] ?? c.campo}: {valor(c.campo, c.antes)} → <strong>{valor(c.campo, c.despues)}</strong>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

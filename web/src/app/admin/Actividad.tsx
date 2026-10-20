// Registro de actividad (solo superadministrador): quién hizo qué y cuándo en cada condominio, con lo que
// cambió. Lo escribe el servidor en cada acción de la administración (ver amplify/functions/shared/firma.ts).
import { useMemo, useState } from 'react';
import { adminCall } from '../api';
import { Empty, ErrorBox, Field, Loading, PageHead, Seg, hoy, useLoad } from '../ui';
import { useAdmin } from './AdminApp';

type Campo = { campo: string; antes: unknown; despues: unknown };
type Cambio = { modelo: string; tipo?: string; op: 'alta' | 'cambio' | 'baja'; id: string; etiqueta: string; campos: Campo[] };
type Entrada = { id: string; fecha: string; porNombre?: string; porEmail?: string; porRol?: string; accion: string; resumen?: string; cambios: Cambio[] };

const OP = { alta: 'Alta', cambio: 'Cambio', baja: 'Eliminado' } as const;
const haceDias = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const fechaHora = (d: string) =>
  new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Nombres legibles de los campos más comunes (el resto se muestra tal cual).
const CAMPOS: Record<string, string> = {
  estado: 'Estado', monto: 'Monto', concepto: 'Concepto', nota: 'Nota', nombre: 'Nombre', email: 'Correo', telefono: 'Teléfono', telefono2: 'Teléfono 2',
  titulo: 'Título', cuerpo: 'Texto', fecha: 'Fecha', vence: 'Vence', unidadId: 'Unidad', condominiosAdmin: 'Condominios asignados',
  rolAdminId: 'Rol', rol: 'Tipo de cuenta', folio: 'Folio', cuotaMensual: 'Cuota mensual', diaVencimiento: 'Día de vencimiento',
  accesos: 'Accesos', documentos: 'Documentos', acceso: 'Acceso', administradores: 'Administradores', etiqueta: 'Unidad',
  propietario: 'Propietario', categoria: 'Categoría', proveedor: 'Proveedor', importante: 'Importante', saldoInicial: 'Saldo inicial',
  historial: 'Seguimiento', horaInicio: 'Hora de inicio', horaFin: 'Hora de fin', activo: 'Activo', modulos: 'Servicios del portal',
  suspendido: 'Suspendido', suspension: 'Suspensión', eliminadoEn: 'En la papelera desde', eliminacion: 'Eliminación', eliminadoPor: 'Eliminado por',
};
const valor = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};

export function Actividad() {
  const { condo, condos, unidades } = useAdmin();
  const [ambito, setAmbito] = useState<'condo' | 'global'>('condo');
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoy());
  const [quien, setQuien] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const condominioId = ambito === 'global' ? 'GLOBAL' : condo?.id;
  const { data, error, loading, reload } = useLoad(
    () => (condominioId ? adminCall<Entrada[]>('actividad.lista', { condominioId, desde, hasta }) : Promise.resolve([])),
    [condominioId, desde, hasta],
  );
  const personas = useMemo(() => [...new Set((data ?? []).map((e) => e.porNombre || '—'))].sort(), [data]);
  const lista = (data ?? []).filter((e) => !quien || (e.porNombre || '—') === quien);
  // Las unidades y condominios se guardan por id: se muestran por su nombre.
  const nombreDe = (campo: string, v: unknown) => {
    if (campo === 'unidadId') return unidades.find((u) => u.id === v)?.etiqueta ?? valor(v);
    if (campo === 'condominiosAdmin' && Array.isArray(v)) return v.map((id) => (id === '*' ? 'Todos' : (condos.find((c) => c.id === id)?.nombre ?? id))).join(', ');
    return valor(v);
  };

  return (
    <div className="stack">
      <PageHead
        icon="clock"
        title="Actividad"
        sub="Quién hizo cada cambio, cuándo y qué cambió. Solo lo ve el superadministrador."
      />
      <section className="panel">
        <Seg
          value={ambito}
          onChange={setAmbito}
          options={[
            ['condo', condo ? condo.nombre : 'Condominio'],
            ['global', 'Cuentas de administración y roles'],
          ]}
        />
        <div className="form-2" style={{ marginTop: 12 }}>
          <Field label="Desde">
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={hasta} min={desde} max={hoy()} onChange={(e) => setHasta(e.target.value)} />
          </Field>
        </div>
        <Field label="Quién">
          <select value={quien} onChange={(e) => setQuien(e.target.value)}>
            <option value="">Todos</option>
            {personas.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      </section>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <ul className="list">
              {lista.map((e) => (
                <li key={e.id} style={{ display: 'block' }}>
                  <button type="button" className="fila-click" style={{ padding: 0 }} onClick={() => setAbierto(abierto === e.id ? null : e.id)}>
                    <span className="list-main">
                      <strong>{e.resumen || e.accion}</strong>
                      <span className="list-sub" style={{ display: 'block' }}>
                        {e.porNombre}
                        {e.porRol === 'SUPERADMIN' && ' (Superadmin)'}
                        {e.porEmail && ` · ${e.porEmail}`} · {fechaHora(e.fecha)}
                      </span>
                      <span className="small muted" style={{ display: 'block' }}>
                        {e.cambios
                          .slice(0, 3)
                          .map((c) => `${c.tipo ?? c.modelo}${c.etiqueta ? `: ${c.etiqueta}` : ''}`)
                          .join(' · ')}
                        {e.cambios.length > 3 && ` y ${e.cambios.length - 3} más`}
                      </span>
                    </span>
                  </button>
                  {abierto === e.id && (
                    <div className="actividad-detalle">
                      {e.cambios.map((c, i) => (
                        <div key={i} className="actividad-cambio">
                          <div className="small">
                            <strong>
                              {OP[c.op]} · {c.tipo ?? c.modelo}
                            </strong>
                            {c.etiqueta && ` · ${c.etiqueta}`}
                          </div>
                          {c.campos.length > 0 && (
                            <ul className="actividad-campos">
                              {c.campos.map((f) => (
                                <li key={f.campo}>
                                  <span className="muted">{CAMPOS[f.campo] ?? f.campo}:</span>{' '}
                                  {c.op === 'cambio' ? (
                                    <>
                                      <s>{nombreDe(f.campo, f.antes)}</s> → {nombreDe(f.campo, f.despues)}
                                    </>
                                  ) : (
                                    nombreDe(f.campo, c.op === 'baja' ? f.antes : f.despues)
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="clock">Sin actividad en esas fechas.</Empty>
          )}
        </section>
      )}
    </div>
  );
}

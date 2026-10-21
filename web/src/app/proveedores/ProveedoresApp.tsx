// /proveedores — bitácora de trabajo de los proveedores (jardinería, alberca, fumigación…). Dos secciones:
// «Levantar reporte» (para la administración o para los residentes: son reportes independientes) y «Ver reportes».
// Enviar = guardar: un reporte enviado ya no se modifica. El acceso lo valida la Lambda portal-api (rol PROVEEDOR,
// sus condominios y solo los mantenimientos que le asignó la administración).
import { useState } from 'react';
import { portal } from '../api';
import { Acceso, Shell, useHashNav } from '../Shell';
import { ElegirArchivo } from '../ElegirArchivo';
import { TarjetaReporteFotos } from '../FotosReporte';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, PageHead, Seg, ToastProvider, fechaHora, hoy, useLoad, useToast } from '../ui';
import { ETIQUETA_DESTINO, MAX_FOTOS_REPORTE, OTRO_SERVICIO, servicioDe, type DestinoReporte, type ReporteProveedor } from '../../../amplify/functions/shared/proveedores';

type Inicio = { nombre: string | null; email: string; empresa: string | null; servicios: string[]; condominios: { id: string; nombre: string }[] };
type Reporte = ReporteProveedor & { tipoOtro?: string | null };

export default function ProveedoresApp() {
  return (
    <ToastProvider>
      <Acceso kicker="Proveedores" hideSignUp foot={<>Tus accesos te los da la administración del condominio. ¿No los tienes? Pídeselos a la administración.</>}>
        <Proveedor />
      </Acceso>
    </ToastProvider>
  );
}

function Proveedor() {
  const { data, error, loading, reload } = useLoad(() => portal<Inicio>('proveedor.inicio'));
  const [cur, go] = useHashNav('levantar');
  // Reporte que se empieza ya con condominio, destino y tipo (después de enviar el otro reporte del mismo trabajo)
  const [siguiente, setSiguiente] = useState<Borrador | null>(null);
  const [n, setN] = useState(0);
  if (loading && !data) return <Loading />;
  if (error && !data)
    return (
      <div className="auth-screen">
        <div className="auth-card panel" style={{ textAlign: 'center', padding: 28 }}>
          <h1 style={{ fontSize: '1.3rem' }}>Esta sección es para proveedores</h1>
          <p className="muted">{error}</p>
          <p>
            <a href="/portal/">Ir al portal de residentes</a> · <a href="/admin/">Ir al panel</a>
          </p>
          <button className="btn-app secondary" onClick={() => reload()}>
            <Icon name="refresh" />
            Intentar de nuevo
          </button>
        </div>
      </div>
    );
  const yo = data!;
  const actual = cur === 'reportes' ? 'reportes' : 'levantar';
  return (
    <Shell
      api="portal"
      nav={[
        { key: 'levantar', label: 'Levantar reporte', icon: 'plus' },
        { key: 'reportes', label: 'Ver reportes', icon: 'file' },
      ]}
      current={actual}
      onNav={(k) => (setSiguiente(null), setN(n + 1), go(k))}
      title="Proveedores"
      subtitle={[yo.nombre || yo.email, yo.empresa].filter(Boolean).join(' · ')}
      user={yo.email}
    >
      {!yo.condominios.length ? (
        <div className="alert">Aún no tienes condominios asignados. Comunícate con la administración.</div>
      ) : actual === 'levantar' ? (
        <Levantar
          key={siguiente ? `sig-${siguiente.destino}-${n}` : `nuevo-${n}`}
          yo={yo}
          inicial={siguiente}
          onVer={() => (setSiguiente(null), go('reportes'))}
          onSiguiente={(b) => (setSiguiente(b), setN(n + 1))}
        />
      ) : (
        <VerReportes onLevantar={() => go('levantar')} />
      )}
    </Shell>
  );
}

// ---------- Ver reportes ----------
function VerReportes({ onLevantar }: { onLevantar: () => void }) {
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [para, setPara] = useState<'TODOS' | DestinoReporte>('TODOS');
  const { data, error, loading, reload } = useLoad(() => portal<Reporte[]>('proveedor.mios', { mes }), [mes]);
  const lista = (data ?? []).filter((r) => para === 'TODOS' || r.destino === para);
  return (
    <div className="stack">
      <PageHead icon="file" title="Ver reportes" sub="Los reportes que ya realizaste. Una vez enviados ya no se modifican." />
      <section className="panel">
        <Field label="Mes">
          <input type="month" value={mes} max={hoy().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </Field>
        <div style={{ marginTop: 12 }}>
          <Seg
            value={para}
            onChange={setPara}
            options={[
              ['TODOS', 'Todos'],
              ['ADMIN', 'Administración'],
              ['RESIDENTES', 'Residentes'],
            ]}
          />
        </div>
      </section>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : lista.length ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {lista.length} reporte(s) en el mes.
          </p>
          {lista.map((r) => (
            <TarjetaReporte key={r.id} r={r} />
          ))}
        </>
      ) : (
        <section className="panel">
          <Empty icon="file">No hay reportes en ese mes.</Empty>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <button className="btn-app" onClick={onLevantar}>
              <Icon name="plus" />
              Levantar reporte
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Reporte en tarjeta compacta; al tocarlo se abre completo (una foto tras otra con su descripción). */
export function TarjetaReporte({ r, mostrarProveedor }: { r: Reporte; mostrarProveedor?: boolean }) {
  const detalle = [fechaHora(r.createdAt), r.condominio, mostrarProveedor && `${r.proveedorNombre ?? ''}${r.empresa ? ` (${r.empresa})` : ''}`].filter(Boolean).join(' · ');
  return (
    <TarjetaReporteFotos
      titulo={servicioDe(r.tipo, r.tipoOtro)}
      detalle={detalle}
      etiqueta={<Badge estado={r.destino === 'ADMIN' ? 'PROGRAMADA' : 'APROBADO'}>Para {ETIQUETA_DESTINO[r.destino].toLowerCase()}</Badge>}
      descripcion={r.descripcion}
      fotos={r.fotos}
    />
  );
}

// ---------- Nuevo reporte ----------
type Borrador = { condominioId: string; destino: DestinoReporte; tipo: string; tipoOtro: string };
type FotoCaptura = { id: number; file: File | null; descripcion: string };
let siguienteId = 1;
const fotoVacia = (): FotoCaptura => ({ id: siguienteId++, file: null, descripcion: '' });

/** Levantar reporte: primero se elige para quién es (son reportes independientes) y después se llena. */
function Levantar({ yo, inicial, onVer, onSiguiente }: { yo: Inicio; inicial: Borrador | null; onVer: () => void; onSiguiente: (b: Borrador) => void }) {
  const [destino, setDestino] = useState<DestinoReporte | null>(inicial?.destino ?? null);
  if (destino) return <NuevoReporte yo={yo} inicial={{ ...(inicial ?? { condominioId: '', tipo: '', tipoOtro: '' }), destino }} onCambiar={() => setDestino(null)} onListo={onVer} onSiguiente={onSiguiente} />;
  const opcion = (d: DestinoReporte, titulo: string, texto: string, icono: string) => (
    <button type="button" className="tile tile-acceso" onClick={() => setDestino(d)}>
      <Icon name={icono} />
      <span className="tile-acceso-txt">
        <strong>{titulo}</strong>
        <span className="small muted">{texto}</span>
      </span>
      <Icon name="arrow" />
    </button>
  );
  return (
    <div className="stack">
      <PageHead icon="plus" title="Levantar reporte" sub="Registra con fotos el trabajo que realizaste. Haz los dos reportes: uno para la administración y otro para los residentes." />
      {opcion('ADMIN', 'Realizar reporte para la administración', 'Detallado: qué se hizo, materiales, observaciones y pendientes.', 'building')}
      {opcion('RESIDENTES', 'Realizar reporte para los residentes', 'Lo que verán los residentes en Mantenimientos › Trabajos realizados.', 'users')}
    </div>
  );
}

function NuevoReporte({
  yo,
  inicial,
  onCambiar,
  onListo,
  onSiguiente,
}: {
  yo: Inicio;
  inicial: Borrador;
  onCambiar: () => void;
  onListo: () => void;
  onSiguiente: (b: Borrador) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Borrador & { descripcion: string }>({
    condominioId: inicial.condominioId || (yo.condominios.length === 1 ? yo.condominios[0].id : ''),
    destino: inicial.destino,
    tipo: inicial.tipo || (yo.servicios.length === 1 ? yo.servicios[0] : ''),
    tipoOtro: inicial.tipoOtro ?? '',
    descripcion: '',
  });
  const [fotos, setFotos] = useState<FotoCaptura[]>([fotoVacia()]);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [enviado, setEnviado] = useState<Borrador | null>(null);
  const cambiaFoto = (id: number, x: Partial<FotoCaptura>) => setFotos(fotos.map((p) => (p.id === id ? { ...p, ...x } : p)));
  const condo = yo.condominios.find((c) => c.id === f.condominioId);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const listas = fotos.filter((p) => p.file);
    if (!f.condominioId) return setError('Elige el condominio.');
    if (!f.tipo) return setError('Elige el tipo de mantenimiento.');
    if (!listas.length) return setError('Agrega al menos una foto.');
    const sinTexto = fotos.findIndex((p) => p.file && !p.descripcion.trim());
    if (sinTexto >= 0) return setError(`Escribe la descripción de la foto ${sinTexto + 1}.`);
    if (fotos.some((p) => !p.file && p.descripcion.trim())) return setError('Hay una descripción sin foto: agrégale la foto o quítala.');
    if (
      !confirm(
        `¿Enviar el reporte para ${ETIQUETA_DESTINO[f.destino].toLowerCase()}?\n\nAl enviarlo se guarda en tu bitácora y YA NO podrás modificarlo ni borrarlo.`,
      )
    )
      return;
    try {
      const subidas: { path: string; descripcion: string }[] = [];
      for (const [i, p] of listas.entries()) {
        setEstado(`Subiendo foto ${i + 1} de ${listas.length}…`);
        const nombre = /\.\w+$/.test(p.file!.name) ? p.file!.name : `${p.file!.name || 'foto'}.jpg`;
        const s = await portal<{ url: string; path: string; contentType: string }>('proveedor.subirFoto', { condominioId: f.condominioId, nombre, tamano: p.file!.size });
        const r = await fetch(s.url, { method: 'PUT', headers: { 'Content-Type': s.contentType }, body: p.file });
        if (!r.ok) throw new Error(`No se pudo subir la foto ${i + 1}. Revisa tu conexión e intenta de nuevo.`);
        subidas.push({ path: s.path, descripcion: p.descripcion.trim() });
      }
      setEstado('Enviando reporte…');
      await portal('proveedor.enviar', { ...f, fotos: subidas });
      toast(`Reporte para ${ETIQUETA_DESTINO[f.destino].toLowerCase()} enviado`);
      setEnviado({ condominioId: f.condominioId, destino: f.destino, tipo: f.tipo, tipoOtro: f.tipoOtro });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEstado('');
    }
  }

  if (enviado) {
    const falta: DestinoReporte = enviado.destino === 'ADMIN' ? 'RESIDENTES' : 'ADMIN';
    return (
      <div className="stack">
        <section className="panel" style={{ textAlign: 'center', padding: 28 }}>
          <div className="tile-icon" style={{ margin: '0 auto 12px' }}>
            <Icon name="check" />
          </div>
          <h1 style={{ fontSize: '1.4rem' }}>Reporte enviado</h1>
          <p className="muted">
            Tu reporte para <strong>{ETIQUETA_DESTINO[enviado.destino].toLowerCase()}</strong> de {condo?.nombre} quedó guardado en tus reportes.
          </p>
          <p>
            Recuerda hacer también el reporte para <strong>{ETIQUETA_DESTINO[falta].toLowerCase()}</strong>.
          </p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <button className="btn-app" onClick={() => onSiguiente({ ...enviado, destino: falta })}>
              <Icon name="plus" />
              Hacer el reporte para {ETIQUETA_DESTINO[falta].toLowerCase()}
            </button>
            <button className="btn-app secondary" onClick={onListo}>
              Ver mis reportes
            </button>
          </div>
        </section>
      </div>
    );
  }

  const ocupado = !!estado;
  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onCambiar} disabled={ocupado}>
          <Icon name="back" /> Levantar reporte
        </button>
      </div>
      <PageHead
        icon={f.destino === 'ADMIN' ? 'building' : 'users'}
        title={f.destino === 'ADMIN' ? 'Reporte para la administración' : 'Reporte para los residentes'}
        sub={f.destino === 'ADMIN' ? 'Detallado: lo ve solo la administración.' : 'Lo verán los residentes en Mantenimientos › Trabajos realizados.'}
      />
      <form className="stack" onSubmit={enviar}>
        <section className="panel form">
          {yo.condominios.length > 1 && (
            <Field label="Condominio">
              <select required value={f.condominioId} onChange={(e) => setF({ ...f, condominioId: e.target.value })} disabled={ocupado}>
                <option value="">Elige el condominio…</option>
                {yo.condominios.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Tipo de mantenimiento">
            <select required value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} disabled={ocupado}>
              <option value="">Elige el tipo…</option>
              {yo.servicios
                .filter((s) => s !== OTRO_SERVICIO)
                .map((s) => (
                  <option key={s}>{s}</option>
                ))}
              {yo.servicios.includes(OTRO_SERVICIO) && <option value={OTRO_SERVICIO}>Otro…</option>}
            </select>
          </Field>
          {f.tipo === OTRO_SERVICIO && (
            <Field label="¿Qué tipo de mantenimiento realizaste?">
              <input required maxLength={80} value={f.tipoOtro} onChange={(e) => setF({ ...f, tipoOtro: e.target.value })} disabled={ocupado} placeholder="Ej. Limpieza de canaletas" />
            </Field>
          )}
          <Field label={f.destino === 'ADMIN' ? 'Descripción del trabajo (detallada)' : 'Descripción para los residentes'}>
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={f.descripcion}
              onChange={(e) => setF({ ...f, descripcion: e.target.value })}
              disabled={ocupado}
              placeholder={f.destino === 'ADMIN' ? 'Qué se hizo, materiales, observaciones, pendientes…' : 'Ej. Se podaron los árboles del andador principal.'}
            />
          </Field>
        </section>

        <section className="panel stack">
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Fotos del trabajo</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Agrega cada foto con su descripción, una por una, hasta terminar (máximo {MAX_FOTOS_REPORTE}).
          </p>
          {fotos.map((p, i) => (
            <div key={p.id} className="foto-captura">
              <div className="foto-captura-cab">
                <strong>Foto {i + 1}</strong>
                {fotos.length > 1 && (
                  <button type="button" className="linklike" style={{ color: 'var(--danger)' }} disabled={ocupado} onClick={() => setFotos(fotos.filter((x) => x.id !== p.id))}>
                    Quitar
                  </button>
                )}
              </div>
              <ElegirArchivo disabled={ocupado} value={p.file} onChange={(fs) => cambiaFoto(p.id, { file: fs[0] ?? null })} />
              <Field label="Descripción de esta foto">
                <textarea rows={2} maxLength={1000} value={p.descripcion} onChange={(e) => cambiaFoto(p.id, { descripcion: e.target.value })} disabled={ocupado} placeholder="Ej. Antes de la poda / Filtro limpio" />
              </Field>
            </div>
          ))}
          {fotos.length < MAX_FOTOS_REPORTE && (
            <button type="button" className="btn-app secondary" disabled={ocupado} onClick={() => setFotos([...fotos, fotoVacia()])}>
              <Icon name="camera" />
              Agregar otra foto
            </button>
          )}
        </section>

        <div className="alert">
          <strong>Importante:</strong> al enviar, el reporte se guarda en tu bitácora y <strong>ya no se puede modificar ni borrar</strong>. Revisa que las fotos y
          descripciones estén completas.
        </div>
        {error && <div className="alert error">{error}</div>}
        <button className="btn-app block" disabled={ocupado}>
          <Icon name="upload" />
          {estado || `Enviar reporte para ${ETIQUETA_DESTINO[f.destino].toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}

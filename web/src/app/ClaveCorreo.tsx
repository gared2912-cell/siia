// Aviso sobre el formulario de acceso cuando se llega desde el correo de bienvenida: muestra la contraseña
// temporal con un botón para copiarla y pegarla donde se necesite.
import { useState } from 'react';
import type { AccesoLiga } from './camposAcceso';

export function ClaveCorreo({ acceso }: { acceso: AccesoLiga }) {
  const [copiada, setCopiada] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(acceso.clave);
      setCopiada(true);
    } catch {
      /* queda visible para copiarla a mano */
    }
  };
  return (
    <div style={{ background: '#e9faf8', borderRadius: 12, padding: '12px 14px', margin: '0 0 12px', display: 'grid', gap: 8, color: '#3a3f55' }}>
      <span style={{ fontSize: '.9rem' }}>Tu contraseña temporal (ya está escrita abajo):</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'Consolas, monospace', fontSize: '1.2rem', letterSpacing: 1, userSelect: 'all' }}>{acceso.clave}</strong>
        <button
          type="button"
          onClick={copiar}
          style={{ background: '#007c7d', color: '#fff', border: 0, borderRadius: 999, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', minHeight: 40 }}
        >
          {copiada ? 'Copiada ✓' : 'Copiar contraseña'}
        </button>
      </div>
      <span style={{ fontSize: '.8rem', color: '#676d86' }}>Al entrar te pediremos crear tu contraseña nueva.</span>
    </div>
  );
}

// Cognito no manda el código de «¿Olvidaste tu contraseña?» a cuentas que aún no entran por primera vez
// (y responde como si lo hubiera enviado), así que se avisa antes de pedirlo.
export function AvisoRestablecer() {
  return (
    <p style={{ background: '#e9faf8', borderRadius: 12, padding: '12px 14px', margin: '0 0 12px', color: '#3a3f55', fontSize: '.9rem', lineHeight: 1.5 }}>
      ¿Aún no has entrado por primera vez? El código no te llegará: usa la contraseña temporal de tu correo de bienvenida o pide a
      la administración que te reenvíe tu acceso.
    </p>
  );
}

import LogoLuxFarma from './LogoLuxFarma';

// Pantalla de carga a pantalla completa con el logo de LuxFarma + barra animada —
// extraída de la "AppLoadingScreen" que ya se ve al entrar a la app ("Preparando tu
// sesión..."), para reutilizar el mismo estilo en cualquier operación que tarde y
// necesite feedback visible (ej. anular un comprobante), en vez de duplicar el JSX o
// dejar solo un botón deshabilitado sin indicio claro de que algo está pasando.
//
// exito=true reemplaza la barra de carga por un check verde animado (mismo lenguaje
// visual que ya usa ProcesandoVenta.jsx para su paso final) — el caller lo activa
// brevemente (~1s) después de que la operación resuelve OK, antes de cerrar el
// overlay, para que la confirmación se sienta real y no como que la pantalla
// simplemente desaparece.
export default function LogoCargandoOverlay({ mensaje = 'Cargando...', exito = false }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--lf-bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '20px', zIndex: 999999,
      fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, sans-serif',
    }}>
      <LogoLuxFarma variant="icon" size={72} color="red" />
      <div style={{ textAlign: 'center' }}>
        <p className="lf-brand-font" style={{ fontSize: 17, fontWeight: 700, color: 'var(--lf-text)', margin: '0 0 8px', letterSpacing: -0.3 }}>
          LuxFarma
        </p>
        <p style={{ fontSize: 16, fontWeight: 600, color: exito ? 'var(--lf-success)' : 'var(--lf-text-muted)', margin: 0 }}>{mensaje}</p>
      </div>
      {exito ? (
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--lf-success), #15803d)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(31, 138, 76, 0.35)',
          animation: 'lco-success-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path d="M5 12l5 5L20 7" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
      ) : (
        <div style={{
          width: 200, height: 4,
          background: 'var(--lf-primary-light)',
          borderRadius: 999,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            background: 'var(--lf-primary)',
            borderRadius: 999,
            animation: 'lco-loadBar 1.6s ease-in-out infinite',
          }} />
        </div>
      )}
      <style>{`
        @keyframes lco-loadBar {
          0%   { width: 0%;   margin-left: 0%; }
          50%  { width: 60%;  margin-left: 20%; }
          100% { width: 0%;   margin-left: 100%; }
        }
        @keyframes lco-success-pop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

import { useEffect, useRef } from 'react';

/**
 * Overlay de checklist al cobrar.
 * Los `completado` de cada paso vienen del flujo real en POS (setPasosVenta).
 * Auto-cierra ~700ms después de que todos estén en true; timeout de seguridad si algo se traba.
 */
export default function ProcesandoVenta({ visible, pasos = [], onCompleto }) {
  const onCompletoRef = useRef(onCompleto);
  useEffect(() => {
    onCompletoRef.current = onCompleto;
  }, [onCompleto]);

  const firedRef = useRef(false);
  const todosCompletos = visible && pasos.length > 0 && pasos.every((p) => p.completado);

  // Cierre normal: todos los checks verdes → breve pausa → onCompleto
  // Importante: NO depender de `onCompleto` en el array (suele ser inline y cancela el timer).
  useEffect(() => {
    if (!visible) {
      firedRef.current = false;
      return undefined;
    }
    if (!todosCompletos || firedRef.current) return undefined;

    firedRef.current = true;
    const timer = setTimeout(() => {
      onCompletoRef.current?.();
    }, 700);
    return () => clearTimeout(timer);
  }, [visible, todosCompletos]);

  // Seguridad: si el overlay sigue visible demasiado (hang de red o timer perdido), forzar cierre.
  useEffect(() => {
    if (!visible) return undefined;
    const safety = setTimeout(() => {
      onCompletoRef.current?.();
    }, 25000);
    return () => clearTimeout(safety);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes pv-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes pv-card-in {
          0%   { opacity: 0; transform: scale(0.92) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pv-spinner-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.08); opacity: 0.85; }
        }
        @keyframes pv-spinner-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes pv-check-pop {
          0%   { transform: scale(0); opacity: 0; }
          50%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pv-check-draw {
          from { stroke-dashoffset: 24; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes pv-step-in {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes pv-success-pulse {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.15); }
          100% { transform: scale(1); }
        }

        .pv-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(14px) saturate(180%);
          -webkit-backdrop-filter: blur(14px) saturate(180%);
          display: flex;
          align-items: center;
          justify-content: center;
          /* Por encima del modal de pago (100030) y de AlertaSistemaModal (100050) */
          z-index: 100060;
          animation: pv-fade-in 0.25s ease-out;
        }

        .pv-card {
          background: rgba(255, 255, 255, 0.98);
          border-radius: 24px;
          width: 340px;
          padding: 2rem 1.75rem 1.75rem;
          box-shadow:
            0 25px 60px rgba(0, 0, 0, 0.25),
            0 0 0 1px rgba(255, 255, 255, 0.5) inset;
          animation: pv-card-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .pv-spinner-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 1.25rem;
          animation: pv-spinner-pulse 1.8s ease-in-out infinite;
        }

        .pv-spinner {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            #3b82f6 0%,
            #60a5fa 40%,
            #93c5fd 70%,
            transparent 100%
          );
          animation: pv-spinner-rotate 1.2s linear infinite;
          position: relative;
        }

        .pv-spinner::before {
          content: '';
          position: absolute;
          inset: 6px;
          border-radius: 50%;
          background: white;
        }

        .pv-spinner-success {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, #10b981, #059669);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: pv-success-pulse 0.5s ease-out;
          box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);
        }

        .pv-spinner-success svg {
          width: 32px;
          height: 32px;
        }

        .pv-spinner-success path {
          stroke: white;
          stroke-width: 3.5;
          stroke-linecap: round;
          stroke-linejoin: round;
          fill: none;
          stroke-dasharray: 24;
          stroke-dashoffset: 24;
          animation: pv-check-draw 0.45s ease-out 0.1s forwards;
        }

        .pv-title {
          text-align: center;
          font-size: 1.05rem;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 0.4rem;
          letter-spacing: -0.01em;
        }

        .pv-subtitle {
          text-align: center;
          font-size: 0.82rem;
          color: #64748b;
          margin: 0 0 1.5rem;
          min-height: 1em;
          transition: all 0.3s ease;
        }

        .pv-steps {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }

        .pv-step {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          padding: 0.4rem 0;
          animation: pv-step-in 0.3s ease-out;
        }

        .pv-step-icon {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .pv-step-icon.pending {
          background: #f1f5f9;
          border: 1.5px solid #cbd5e1;
        }

        .pv-step-icon.active {
          background: linear-gradient(135deg, #dbeafe, #bfdbfe);
          border: 1.5px solid #3b82f6;
          animation: pv-spinner-pulse 1.2s ease-in-out infinite;
        }

        .pv-step-icon.done {
          background: linear-gradient(135deg, #10b981, #059669);
          border: 1.5px solid transparent;
          animation: pv-check-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .pv-step-icon.done svg {
          width: 13px;
          height: 13px;
        }

        .pv-step-icon.done path {
          stroke: white;
          stroke-width: 3.5;
          stroke-linecap: round;
          stroke-linejoin: round;
          fill: none;
          stroke-dasharray: 24;
          stroke-dashoffset: 24;
          animation: pv-check-draw 0.35s ease-out forwards;
        }

        .pv-step-icon.active::after {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #3b82f6;
        }

        .pv-step-label {
          font-size: 0.88rem;
          color: #475569;
          font-weight: 500;
          transition: all 0.3s ease;
          flex: 1;
        }

        .pv-step-label.done {
          color: #0f172a;
          font-weight: 600;
        }

        .pv-step-label.active {
          color: #1e40af;
          font-weight: 600;
        }
      `}</style>

      <div className="pv-overlay" role="status" aria-live="polite" aria-busy={!todosCompletos}>
        <div className="pv-card">
          <div className="pv-spinner-wrap">
            {todosCompletos ? (
              <div className="pv-spinner-success">
                <svg viewBox="0 0 24 24">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </div>
            ) : (
              <div className="pv-spinner" />
            )}
          </div>

          <h3 className="pv-title">
            {todosCompletos ? '¡Venta completada!' : 'Procesando venta'}
          </h3>

          <p className="pv-subtitle">
            {todosCompletos
              ? 'Listo — cerrando…'
              : (pasos.find((p) => !p.completado)?.label || 'Casi listo...')}
          </p>

          <div className="pv-steps">
            {pasos.map((paso, idx) => {
              const previo = idx === 0 || pasos[idx - 1].completado;
              const estado = paso.completado ? 'done' : (previo ? 'active' : 'pending');

              return (
                <div key={paso.id} className="pv-step">
                  <div className={`pv-step-icon ${estado}`}>
                    {estado === 'done' && (
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`pv-step-label ${estado}`}>
                    {paso.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

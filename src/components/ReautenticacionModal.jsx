import { useState } from 'react';
import { verificarPasswordCuenta } from '../services/authCuenta';
import UiIcon from './UiIcon';

// Confirmación de contraseña sin cerrar sesión — misma lógica que Login
// (bcrypt + migración lazy de texto plano legado).
export default function ReautenticacionModal({ visible, mensaje, onConfirmar, onCancelar }) {
  const [password, setPassword] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState('');

  if (!visible) return null;

  const cerrar = () => {
    setPassword('');
    setError('');
    onCancelar();
  };

  const handleConfirmar = async (e) => {
    e.preventDefault();
    setError('');
    setVerificando(true);
    try {
      await verificarPasswordCuenta(password);
      setPassword('');
      setVerificando(false);
      onConfirmar();
    } catch (err) {
      setError('Error al verificar: ' + err.message);
      setVerificando(false);
    }
  };

  // z-index 100060: por encima de AlertaSistemaModal (100050).
  return (
    <div className="modal-overlay-strict" style={{ zIndex: 100060 }} role="dialog" aria-modal="true" data-keyboard-trap>
      <div style={{ background: 'white', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 380, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)' }}>
        <h3 style={{ margin: '0 0 0.5rem', color: 'var(--lf-text)', fontSize: '1.15rem' }}><UiIcon name="Lock" size={15} /> Confirma tu contraseña</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--lf-text-muted)', marginBottom: '1.2rem' }}>
          {mensaje || 'Esta acción requiere confirmar tu contraseña de administrador.'}
        </p>
        <form onSubmit={handleConfirmar}>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Tu contraseña"
            style={{ width: '100%', padding: '0.7rem', border: '1px solid #E4E4E7', borderRadius: 8, fontSize: '0.95rem', marginBottom: error ? '0.4rem' : '1rem', boxSizing: 'border-box' }}
            required
          />
          {error && <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: '0 0 1rem', fontWeight: 600 }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" data-enter-skip="true" tabIndex={-1} onClick={cerrar} style={{ flex: 1, padding: '0.7rem', background: 'var(--lf-info-bg)', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', color: '#52525B' }}>
              Cancelar
            </button>
            <button type="submit" disabled={verificando} style={{ flex: 1, padding: '0.7rem', background: 'var(--lf-primary-dark)', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
              {verificando ? 'Verificando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import icono from '../../assets/icono.png';
import { supabase } from '../../supabaseClient';
import './ForgotModal.css';
import UiIcon from '../../components/UiIcon';

export default function ForgotModal({ onClose }) {
  const [paso, setPaso] = useState(1);
  const [dni, setDni] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [usuarioEncontrado, setUsuarioEncontrado] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [exitoso, setExitoso] = useState(false);

  const handleBuscarUsuario = async (e) => {
    e.preventDefault();
    if (dni.length !== 8) {
      setError('El DNI debe tener 8 dígitos.');
      return;
    }
    setError('');
    setBuscando(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id_usuario, nombres, apellidos, id_sucursal, activo')
        .eq('dni', dni)
        .single();

      if (error || !data) {
        setError('No se encontró ningún usuario con ese DNI.');
        return;
      }
      if (!data.activo) {
        setError('Este usuario está inactivo. Contacte a soporte directamente.');
        return;
      }
      setUsuarioEncontrado(data);
      setPaso(2);
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setBuscando(false);
    }
  };

  const handleEnviarTicket = async (e) => {
    e.preventDefault();
    if (!usuarioEncontrado) return;
    setEnviando(true);
    try {
      const { error } = await supabase.from('tickets_soporte').insert({
        id_usuario: usuarioEncontrado.id_usuario,
        id_sucursal: usuarioEncontrado.id_sucursal,
        asunto: 'Recuperación de contraseña',
        descripcion: descripcion || 'El usuario solicita recuperación de contraseña.',
        prioridad: 'Alta',
        tipo: 'Prob. Técnico',
        estado: 'PENDIENTE',
      });
      if (error) throw error;
      setExitoso(true);
    } catch {
      setError('Error al enviar el ticket. Intenta nuevamente.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">

        {/* TITLEBAR estilo macOS */}
        <div className="modal-header-blue">
          <button className="close-button" onClick={onClose} aria-label="Cerrar"><UiIcon name="X" size={16} /></button>
          <span className="dot-yellow"></span>
          <span className="dot-green"></span>
          <h2>Recuperar contraseña</h2>
        </div>

        <div className="modal-body-split">

          {/* LOGO IZQUIERDO */}
          <div className="modal-left">
            <img src={icono} alt="Cruz Farmacia" className="modal-logo-huge" />
            <div className="modal-left-label">Salud Futura</div>
            <div className="modal-left-sublabel">Sistema de Farmacia</div>
          </div>

          {/* CONTENIDO DERECHO */}
          <div className="modal-right">

            {exitoso ? (
              /* === ESTADO EXITOSO === */
              <div className="modal-success-state">
                <div className="success-circle"><UiIcon name="Check" size={16} /></div>
                <h3>¡Solicitud enviada!</h3>
                <p>
                  Tu solicitud fue registrada. El administrador restablecerá tu contraseña a tu
                  <strong> número de DNI</strong> como clave temporal.
                </p>
                <p style={{ fontSize: '0.78rem', color: '#888' }}>
                  Una vez procesada, ingresa usando <strong>tu DNI como contraseña</strong> y cámbiala desde tu perfil.
                </p>
                <button className="btn-ticket success" onClick={onClose}>
                  Entendido
                </button>
              </div>

            ) : paso === 1 ? (
              /* === PASO 1: INGRESAR DNI === */
              <>
                <div className="modal-right-icon"><UiIcon name="Lock" size={16} /></div>
                <h3>Ingresa tu DNI</h3>
                <p>Te identificaremos para enviar la solicitud al área de soporte.</p>
                <form onSubmit={handleBuscarUsuario} className="modal-form">
                  <div className="modal-input-group">
                    <label>DNI</label>
                    <input
                      type="text"
                      maxLength="8"
                      inputMode="numeric"
                      placeholder="12345678"
                      value={dni}
                      onChange={(e) => {
                        setError('');
                        setDni(e.target.value.replace(/\D/g, ''));
                      }}
                      autoFocus
                    />
                  </div>
                  <div className="modal-hint">
                    <span style={{ color: '#28c840', fontSize: '12px' }}><UiIcon name="Check" size={16} /></span>
                    Tu información está protegida
                  </div>
                  {error && <p className="modal-error">{error}</p>}
                  <button type="submit" className="btn-ticket" disabled={buscando || dni.length !== 8}>
                    {buscando ? 'Buscando...' : 'Continuar →'}
                  </button>
                </form>
              </>

            ) : (
              /* === PASO 2: CONFIRMAR Y ENVIAR === */
              <>
                <div className="modal-right-icon"><UiIcon name="ClipboardList" size={16} /></div>
                <h3>Confirmar solicitud</h3>
                <div className="modal-user-found">
                  <span className="user-icon"><UiIcon name="User" size={16} /></span>
                  <div>
                    <strong>{usuarioEncontrado.nombres} {usuarioEncontrado.apellidos}</strong>
                    <small>DNI: {dni}</small>
                  </div>
                </div>
                <form onSubmit={handleEnviarTicket} className="modal-form">
                  <div className="modal-input-group">
                    <label>
                      Comentario adicional{' '}
                      <span style={{ fontWeight: 400, color: '#aaa' }}>(opcional)</span>
                    </label>
                    <textarea
                      rows="3"
                      placeholder="Ej: No recuerdo mi contraseña desde ayer..."
                      value={descripcion}
                      onChange={(e) => setDescripcion(e.target.value)}
                    />
                  </div>
                  {error && <p className="modal-error">{error}</p>}
                  <button type="submit" className="btn-ticket" disabled={enviando}>
                    {enviando ? 'Enviando...' : 'Enviar solicitud'}
                  </button>
                  <button
                    type="button"
                    className="btn-ticket-back"
                    onClick={() => { setPaso(1); setError(''); }}
                    disabled={enviando}
                  >
                    ← Volver
                  </button>
                </form>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
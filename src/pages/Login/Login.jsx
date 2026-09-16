import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { verificarYMigrarSiPlano } from '../../utils/passwordHash';
import { esAdmin } from '../../utils/roles';
import PasswordField from '../../components/PasswordField';
import './Login.css';
import icono from '../../assets/icono.png';
import LoadingScreen from './LoadingScreen';
import ForgotModal from './ForgotModal';
import { APP_VERSION } from '../../appVersion';

export default function Login() {
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Buscar solo por DNI — la contraseña se verifica en cliente (bcrypt o legado plano).
      const { data, error } = await supabase
        .from('usuarios')
        .select('*, roles(nombre), sucursales(id_sucursal, nombre_comercial, direccion, ruc, telefono)')
        .eq('dni', dni)
        .maybeSingle();

      if (error || !data) {
        setError('DNI o contraseña incorrectos.');
        setLoading(false);
        return;
      }

      const { ok } = await verificarYMigrarSiPlano({
        id_usuario: data.id_usuario,
        plain: password,
        stored: data.password_hash,
      });
      if (!ok) {
        setError('DNI o contraseña incorrectos.');
        setLoading(false);
        return;
      }

      if (!data.activo) {
        setError('Este usuario está inactivo. Contacte a soporte.');
        setLoading(false);
        return;
      }
      setTimeout(() => {
        const { password_hash: _password_hash, ...userData } = data;
        login(userData);
        if (esAdmin(userData.id_rol)) {
          navigate('/admin-dashboard');
        } else {
          navigate('/dashboard');
        }
      }, 800);
    } catch {
      setError('Error de conexión con el servidor.');
      setLoading(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="login-page">

      {/* Estrellas de fondo */}
      {[
        { top: '8%',  left: '12%', size: 2,   dur: '3.2s', delay: '0s',   minOp: 0.2, maxOp: 0.8 },
        { top: '15%', left: '80%', size: 2.5, dur: '4s',   delay: '0.8s', minOp: 0.15, maxOp: 0.7 },
        { top: '70%', left: '8%',  size: 2,   dur: '3.8s', delay: '1.2s', minOp: 0.2, maxOp: 0.9 },
        { top: '75%', left: '88%', size: 1.5, dur: '2.8s', delay: '0.4s', minOp: 0.3, maxOp: 1 },
        { top: '40%', left: '5%',  size: 1.5, dur: '5s',   delay: '2s',   minOp: 0.1, maxOp: 0.6 },
        { top: '30%', left: '92%', size: 2,   dur: '3.5s', delay: '1.5s', minOp: 0.2, maxOp: 0.8 },
        { top: '85%', left: '45%', size: 1.5, dur: '4.2s', delay: '0.6s', minOp: 0.1, maxOp: 0.5 },
        { top: '5%',  left: '55%', size: 2,   dur: '3s',   delay: '1.8s', minOp: 0.2, maxOp: 0.9 },
      ].map((s, i) => (
        <div key={i} className="login-star" style={{
          top: s.top, left: s.left,
          width: s.size, height: s.size,
          '--dur': s.dur, '--delay': s.delay,
          '--min-op': s.minOp, '--max-op': s.maxOp,
        }} />
      ))}

      <div className="login-card">

        {/* ── BANNER con ilustración nocturna ── */}
        <div className="login-banner">

          {/* Luna desplazada a la derecha */}
          <div className="login-moon" />

          {/* Estrellas del banner */}
          {[
            { top: '18%', left: '12%', dur: '3s',   delay: '0.3s' },
            { top: '10%', left: '38%', dur: '4s',   delay: '1s'   },
            { top: '25%', left: '72%', dur: '3.5s', delay: '0.7s' },
            { top: '8%',  left: '55%', dur: '2.8s', delay: '1.4s' },
            { top: '30%', left: '22%', dur: '4.2s', delay: '0.5s' },
            { top: '15%', left: '85%', dur: '3.8s', delay: '1.1s' },
          ].map((s, i) => (
            <div key={i} className="banner-star" style={{
              top: s.top, left: s.left,
              '--dur': s.dur, '--delay': s.delay,
            }} />
          ))}

          {/* ── BRANDING CENTRAL — logo grande + nombre con efecto ── */}
          <div className="login-banner-logo">
            <img src={icono} alt="Salud Futura" className="login-logo" />
            <div className="login-banner-brand">
              <h1>SALUD FUTURA</h1>
              <p>Sistema Integral de Farmacia</p>
            </div>
          </div>

          {/* SVG Paisaje */}
          <svg viewBox="0 0 500 110" xmlns="http://www.w3.org/2000/svg">
            {/* Montañas fondo */}
            <path d="M0,75 Q50,20 100,55 Q130,28 165,58 Q195,22 235,55 Q268,28 305,58 Q338,22 375,55 Q410,28 460,55 L500,60 L500,110 L0,110 Z"
              fill="#0d4080" opacity="0.65" />
            {/* Montañas medias */}
            <path d="M0,85 Q40,48 75,68 Q108,42 140,65 Q172,45 210,68 Q242,44 278,67 Q310,46 348,68 Q380,44 420,67 L500,72 L500,110 L0,110 Z"
              fill="#0a3266" opacity="0.85" />
            {/* Colinas frente */}
            <path d="M0,95 Q55,68 110,85 Q162,65 215,85 Q268,67 325,86 Q378,66 440,85 L500,88 L500,110 L0,110 Z"
              fill="#072550" />
            {/* Árboles izquierda */}
            <rect x="22" y="88" width="5" height="16" rx="1.5" fill="#041c3a" />
            <ellipse cx="24.5" cy="83" rx="11" ry="15" fill="#0d4a8f" />
            <rect x="40" y="91" width="4" height="13" rx="1" fill="#041c3a" />
            <ellipse cx="42" cy="87" rx="9" ry="12" fill="#0a3d7a" />
            <rect x="55" y="93" width="3" height="10" rx="1" fill="#041c3a" />
            <ellipse cx="56.5" cy="89" rx="7" ry="10" fill="#0d4a8f" />
            {/* Árboles derecha */}
            <rect x="430" y="87" width="5" height="16" rx="1.5" fill="#041c3a" />
            <ellipse cx="432.5" cy="82" rx="12" ry="15" fill="#0d4a8f" />
            <rect x="450" y="90" width="4" height="13" rx="1" fill="#041c3a" />
            <ellipse cx="452" cy="86" rx="9" ry="12" fill="#0a3d7a" />
            <rect x="466" y="92" width="3" height="11" rx="1" fill="#041c3a" />
            <ellipse cx="467.5" cy="88" rx="8" ry="11" fill="#0d4a8f" />
            {/* Árboles centro */}
            <rect x="228" y="90" width="4" height="13" rx="1" fill="#041c3a" />
            <ellipse cx="230" cy="86" rx="9" ry="12" fill="#0a3878" />
            <rect x="245" y="92" width="3" height="11" rx="1" fill="#041c3a" />
            <ellipse cx="246.5" cy="88" rx="7" ry="10" fill="#0d4a8f" />
            {/* Reflejo luna en camino */}
            <ellipse cx="250" cy="106" rx="20" ry="3.5" fill="rgba(255,230,80,0.1)" />
            <path d="M238,110 Q248,102 250,98 Q252,102 262,110 Z" fill="rgba(255,230,80,0.07)" />
          </svg>

          {/* Texto "Bienvenido" sobre el paisaje */}
          <div className="login-banner-text">
            <h2>Bienvenido de vuelta</h2>
            <p>Accede a tu sistema de farmacia</p>
          </div>

        </div>

        {/* ── FORMULARIO ── */}
        <div className="login-form-section">
          <div className="login-body">
            <div className="info-badge">
              El modo de acceso se define con tus credenciales
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="input-group">
                <label htmlFor="dni">DNI</label>
                <input
                  type="text"
                  id="dni"
                  maxLength="8"
                  value={dni}
                  placeholder="Ingresa tu DNI"
                  onChange={(e) => setDni(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="input-group">
                <div className="label-row">
                  <label htmlFor="password">CONTRASEÑA</label>
                  <button
                    type="button"
                    className="forgot-link-btn"
                    onClick={() => setIsModalOpen(true)}
                  >
                    ¿Olvidaste?
                  </button>
                </div>
                <PasswordField
                  id="password"
                  value={password}
                  placeholder="Ingresa tu contraseña"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && <p className="error-message">{error}</p>}

              <button type="submit" className="btn-submit">
                Ingresar al sistema
              </button>
            </form>
          </div>

          <div className="bottom-divider" />

          <div className="login-footer">
            Sesión única · Bloqueo tras 3 intentos fallidos
          </div>
        </div>

      </div>

      {isModalOpen && <ForgotModal onClose={() => setIsModalOpen(false)} />}
      <p className="login-version">
        Salud Futura v{APP_VERSION}
        <span className="login-version-sep" aria-hidden="true"> · </span>
        <span className="login-credit">Hecho por Brayan Siccha (M1000)</span>
      </p>
    </div>
  );
}
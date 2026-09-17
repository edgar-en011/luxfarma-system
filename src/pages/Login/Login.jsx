import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { verificarYMigrarSiPlano } from '../../utils/passwordHash';
import { esAdmin } from '../../utils/roles';
import PasswordField from '../../components/PasswordField';
import './Login.css';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import LoadingScreen from './LoadingScreen';
import ForgotModal from './ForgotModal';
import { APP_VERSION } from '../../appVersion';
import UiIcon from '../../components/UiIcon';

function SaludoIcon({ periodo }) {
  if (periodo === 'manana') {
    return (
      <span className="login-saludo-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </span>
    );
  }
  if (periodo === 'tarde') {
    return (
      <span className="login-saludo-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M17 18a5 5 0 0 0-10 0" />
          <path d="M12 2v2" />
          <path d="m4.93 10.93 1.41 1.41" />
          <path d="M2 18h2" />
          <path d="M20 18h2" />
          <path d="m19.07 10.93-1.41 1.41" />
          <path d="M22 22H2" />
          <path d="M16 14a4 4 0 0 0-8 0" />
        </svg>
      </span>
    );
  }
  return (
    <span className="login-saludo-ico login-saludo-ico--noche" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z" />
      </svg>
    </span>
  );
}

/** Nube #FFFFFF con volumen (2 tonos) y sombra inferior suave, sin tinte rosa. */
function SvgCloud({ className }) {
  return (
    <svg className={className} viewBox="0 0 220 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="110" cy="64" rx="82" ry="20" fill="rgb(55 40 40 / 0.14)" />
      <ellipse cx="68" cy="52" rx="44" ry="26" fill="rgb(255 255 255 / 0.72)" />
      <ellipse cx="155" cy="54" rx="36" ry="22" fill="rgb(255 255 255 / 0.72)" />
      <ellipse cx="112" cy="42" rx="52" ry="30" fill="#FFFFFF" />
      <ellipse cx="78" cy="40" rx="34" ry="22" fill="#FFFFFF" />
      <ellipse cx="148" cy="44" rx="30" ry="20" fill="#FFFFFF" />
    </svg>
  );
}

/** Paisaje urbano peruano en 3 capas + farmacia LuxFarma. */
function LoginCityscape({ parallax }) {
  const style = {
    '--parallax-x': `${parallax.x}px`,
    '--parallax-y': `${parallax.y}px`,
  };
  return (
    <div className="login-cityscape" style={style} aria-hidden="true">
      <svg
        className="login-cityscape-svg"
        viewBox="0 0 900 200"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className="city-layer city-layer-back" fill="#FFB0B6" opacity="0.35">
          <path d="M20 140 V78 H52 V140 Z" />
          <path d="M20 78 L36 58 L52 78 Z" />
          <rect x="28" y="52" width="10" height="8" rx="1" />
          <line x1="33" y1="52" x2="33" y2="42" stroke="#FFB0B6" strokeWidth="1.5" />
          <path d="M58 140 V62 H98 V140 Z" />
          <path d="M58 62 L78 44 L98 62 Z" />
          <circle cx="88" cy="50" r="5" />
          <path d="M108 140 V50 H148 V140 Z" />
          <rect x="112" y="40" width="28" height="12" rx="1" />
          <line x1="126" y1="40" x2="126" y2="28" stroke="#FFB0B6" strokeWidth="1.5" />
          <line x1="120" y1="32" x2="132" y2="32" stroke="#FFB0B6" strokeWidth="1.2" />
          <path d="M158 140 V70 H210 V140 Z" />
          <path d="M158 70 L184 48 L210 70 Z" />
          <path d="M220 140 V42 H268 V140 Z" />
          <rect x="232" y="30" width="22" height="14" rx="2" />
          <circle cx="243" cy="28" r="4" />
          <path d="M278 140 V78 H318 V140 Z" />
          <path d="M278 78 L298 60 L318 78 Z" />
          <path d="M700 140 V55 H748 V140 Z" />
          <path d="M700 55 L724 36 L748 55 Z" />
          <rect x="718" y="28" width="12" height="10" rx="1" />
          <path d="M758 140 V68 H812 V140 Z" />
          <path d="M758 68 L785 46 L812 68 Z" />
          <line x1="800" y1="46" x2="800" y2="34" stroke="#FFB0B6" strokeWidth="1.5" />
          <path d="M822 140 V80 H870 V140 Z" />
          <path d="M822 80 L846 62 L870 80 Z" />
        </g>

        <g className="city-layer city-layer-mid">
          <g fill="var(--lf-primary-hover)" opacity="0.62">
            <path d="M40 150 V95 H95 V150 Z" />
            <path d="M40 95 L67.5 78 L95 95 Z" />
            <path d="M105 150 V88 H165 V150 Z" />
            <path d="M105 88 L135 68 L165 88 Z" />
            <path d="M175 150 V100 H240 V150 Z" />
            <path d="M175 100 L207 82 L240 100 Z" />
            <path d="M660 150 V92 H720 V150 Z" />
            <path d="M660 92 L690 74 L720 92 Z" />
            <path d="M730 150 V85 H800 V150 Z" />
            <path d="M730 85 L765 66 L800 85 Z" />
            <path d="M810 150 V98 H870 V150 Z" />
            <path d="M810 98 L840 80 L870 98 Z" />
          </g>
          <g fill="rgb(255 220 180 / 0.55)">
            <rect x="52" y="108" width="10" height="12" rx="1" />
            <rect x="70" y="108" width="10" height="12" rx="1" />
            <rect x="52" y="126" width="10" height="12" rx="1" />
            <rect x="70" y="126" width="10" height="12" rx="1" />
            <rect x="118" y="100" width="11" height="13" rx="1" />
            <rect x="138" y="100" width="11" height="13" rx="1" />
            <rect x="118" y="120" width="11" height="13" rx="1" />
            <rect x="138" y="120" width="11" height="13" rx="1" />
            <rect x="190" y="112" width="12" height="14" rx="1" />
            <rect x="210" y="112" width="12" height="14" rx="1" />
            <rect x="675" y="108" width="11" height="12" rx="1" />
            <rect x="693" y="108" width="11" height="12" rx="1" />
            <rect x="748" y="100" width="12" height="14" rx="1" />
            <rect x="768" y="100" width="12" height="14" rx="1" />
            <rect x="828" y="112" width="11" height="12" rx="1" />
            <rect x="846" y="112" width="11" height="12" rx="1" />
          </g>
          <g fill="var(--lf-primary-dark)" opacity="0.55">
            <rect x="60" y="138" width="14" height="12" rx="1" />
            <rect x="128" y="136" width="16" height="14" rx="1" />
            <rect x="200" y="136" width="16" height="14" rx="1" />
            <rect x="682" y="136" width="14" height="14" rx="1" />
            <rect x="756" y="134" width="16" height="16" rx="1" />
          </g>
          <g fill="#FFFFFF" opacity="0.55">
            <path d="M50 104 H88 L84 110 H54 Z" />
            <path d="M186 108 H234 L230 114 H190 Z" />
            <path d="M742 96 H788 L784 102 H746 Z" />
          </g>
        </g>

        <g className="city-layer city-layer-front">
          <rect x="0" y="168" width="900" height="32" fill="var(--lf-primary-dark)" />
          <rect x="0" y="166" width="900" height="3" fill="#7A0B18" />

          <g fill="var(--lf-primary-dark)">
            <path d="M8 168 V118 H70 V168 Z" />
            <path d="M8 118 L39 100 L70 118 Z" />
            <path d="M78 168 V124 H130 V168 Z" />
            <path d="M78 124 L104 108 L130 124 Z" />
            <path d="M770 168 V120 H830 V168 Z" />
            <path d="M770 120 L800 102 L830 120 Z" />
            <path d="M838 168 V128 H892 V168 Z" />
            <path d="M838 128 L865 112 L892 128 Z" />
          </g>
          <g fill="rgb(255 176 32 / 0.45)">
            <rect x="22" y="130" width="9" height="11" rx="1" />
            <rect x="42" y="130" width="9" height="11" rx="1" />
            <rect x="92" y="136" width="9" height="10" rx="1" />
            <rect x="110" y="136" width="9" height="10" rx="1" />
            <rect x="786" y="132" width="9" height="11" rx="1" />
            <rect x="806" y="132" width="9" height="11" rx="1" />
            <rect x="852" y="138" width="9" height="10" rx="1" />
            <rect x="870" y="138" width="9" height="10" rx="1" />
          </g>

          <g className="city-pharmacy">
            <rect x="340" y="78" width="220" height="90" fill="var(--lf-primary-dark)" />
            <rect x="352" y="86" width="196" height="28" rx="3" fill="#FFFFFF" />
            <path
              fill="var(--lf-primary)"
              fillRule="evenodd"
              d="M372 93h6v7h7v6h-7v7h-6v-7h-7v-6h7v-7zm2 2v5h-5v2h5v5h2v-5h5v-2h-5v-5h-2z"
            />
            <text
              x="392"
              y="106"
              fill="var(--lf-primary)"
              fontFamily="Georgia, 'Zilla Slab', serif"
              fontSize="15"
              fontWeight="700"
              letterSpacing="0.5"
            >
              LuxFarma
            </text>
            <g>
              <rect x="348" y="116" width="204" height="12" fill="#FFFFFF" />
              <rect x="348" y="116" width="17" height="12" fill="var(--lf-primary)" />
              <rect x="382" y="116" width="17" height="12" fill="var(--lf-primary)" />
              <rect x="416" y="116" width="17" height="12" fill="var(--lf-primary)" />
              <rect x="450" y="116" width="17" height="12" fill="var(--lf-primary)" />
              <rect x="484" y="116" width="17" height="12" fill="var(--lf-primary)" />
              <rect x="518" y="116" width="17" height="12" fill="var(--lf-primary)" />
              <path d="M348 128 L344 134 H556 L552 128 Z" fill="var(--lf-primary-hover)" opacity="0.85" />
            </g>
            <rect x="360" y="136" width="36" height="28" rx="2" fill="rgb(255 176 32 / 0.6)" />
            <rect x="504" y="136" width="36" height="28" rx="2" fill="rgb(255 176 32 / 0.6)" />
            <line x1="378" y1="136" x2="378" y2="164" stroke="var(--lf-primary-dark)" strokeWidth="1.5" opacity="0.35" />
            <line x1="360" y1="150" x2="396" y2="150" stroke="var(--lf-primary-dark)" strokeWidth="1.5" opacity="0.35" />
            <line x1="522" y1="136" x2="522" y2="164" stroke="var(--lf-primary-dark)" strokeWidth="1.5" opacity="0.35" />
            <line x1="504" y1="150" x2="540" y2="150" stroke="var(--lf-primary-dark)" strokeWidth="1.5" opacity="0.35" />
            <rect x="416" y="134" width="68" height="34" rx="2" fill="rgb(255 255 255 / 0.22)" stroke="rgb(255 255 255 / 0.45)" strokeWidth="1.5" />
            <line x1="450" y1="134" x2="450" y2="168" stroke="rgb(255 255 255 / 0.4)" strokeWidth="1.5" />
            <path d="M422 138 L438 146" stroke="rgb(255 255 255 / 0.55)" strokeWidth="2" strokeLinecap="round" />
            <g className="city-glow-cross" transform="translate(548 72)">
              <circle cx="14" cy="14" r="13" fill="rgb(255 176 32 / 0.25)" />
              <path fill="#FFFFFF" d="M11 4h6v7h7v6h-7v7h-6v-7H4v-6h7V4z" />
            </g>
          </g>

          <g>
            <ellipse cx="300" cy="152" rx="18" ry="16" fill="#7A1520" opacity="0.85" />
            <ellipse cx="300" cy="142" rx="14" ry="12" fill="#8B1A26" />
            <rect x="297" y="158" width="6" height="12" fill="#5C0E16" />
            <ellipse cx="620" cy="150" rx="16" ry="14" fill="#7A1520" opacity="0.85" />
            <ellipse cx="620" cy="140" rx="12" ry="11" fill="#8B1A26" />
            <rect x="617" y="156" width="6" height="12" fill="#5C0E16" />
            <ellipse cx="160" cy="154" rx="12" ry="11" fill="#7A1520" opacity="0.8" />
            <rect x="158" y="160" width="4" height="10" fill="#5C0E16" />
          </g>

          <g>
            <rect x="250" y="118" width="3" height="50" fill="#5C0E16" />
            <path d="M241 118 H262" stroke="#5C0E16" strokeWidth="2" />
            <ellipse cx="244" cy="120" rx="5" ry="3" fill="rgb(255 176 32 / 0.55)" />
          </g>

          <g>
            <ellipse cx="330" cy="162" rx="7" ry="5" fill="#16A34A" opacity="0.7" />
            <path d="M324 162 H336 L334 170 H326 Z" fill="#7A1520" />
            <ellipse cx="580" cy="162" rx="7" ry="5" fill="#16A34A" opacity="0.7" />
            <path d="M574 162 H586 L584 170 H576 Z" fill="#7A1520" />
          </g>
        </g>
      </svg>
    </div>
  );
}

export default function Login() {
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const navigate = useNavigate();
  const { login } = useAuth();

  const handleBrandMove = (e) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    setParallax({
      x: Math.max(-1, Math.min(1, nx)) * 8,
      y: Math.max(-1, Math.min(1, ny)) * 6,
    });
  };

  const handleBrandLeave = () => setParallax({ x: 0, y: 0 });

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

  const hora = new Date().getHours();
  const periodo = hora >= 5 && hora < 12
    ? 'manana'
    : hora >= 12 && hora < 19
      ? 'tarde'
      : 'noche';
  const saludo = periodo === 'manana'
    ? 'Buenos días'
    : periodo === 'tarde'
      ? 'Buenas tardes'
      : 'Buenas noches';

  return (
    <div className="login-page">
      <aside
        className="login-brand"
        onMouseMove={handleBrandMove}
        onMouseLeave={handleBrandLeave}
      >
        <div className="login-brand-scene" aria-hidden="true">
          <div className="login-sun login-sun--brand">
            <div className="login-sun-halo" />
            <div className="login-sun-rays" />
            <div className="login-sun-core" />
          </div>

          <SvgCloud className="login-cloud-svg login-cloud-svg-1" />
          <SvgCloud className="login-cloud-svg login-cloud-svg-2" />
          <SvgCloud className="login-cloud-svg login-cloud-svg-3" />

          <LoginCityscape parallax={parallax} />
        </div>

        <div className="login-brand-content">
          <div className="login-brand-logo anim-stagger-1">
            <LogoLuxFarma variant="full" size={64} color="white" showSubtitle />
          </div>
          <h1 className="login-brand-title anim-stagger-2">
            Tu farmacia,<br />siempre en orden.
          </h1>
          <p className="login-brand-sub anim-stagger-3">
            Ventas, inventario y respaldo en la nube en un solo lugar.
          </p>
          <ul className="login-benefits anim-stagger-4">
            <li>
              <span className="login-benefit-ico"><UiIcon name="Zap" size={15} /></span>
              Punto de venta rápido
            </li>
            <li>
              <span className="login-benefit-ico"><UiIcon name="Package" size={15} /></span>
              Control de inventario y vencimientos
            </li>
            <li>
              <span className="login-benefit-ico"><UiIcon name="Upload" size={15} /></span>
              Respaldo seguro en la nube
            </li>
          </ul>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-mobile-banner" aria-hidden="true">
          <div className="login-sun login-sun--mobile">
            <div className="login-sun-halo" />
            <div className="login-sun-rays" />
            <div className="login-sun-core" />
          </div>
          <LogoLuxFarma variant="full" size={36} color="white" />
        </div>

        <div className="login-form-wrap">
          <div className="login-card">
            <div className="login-mobile-logo">
              <LogoLuxFarma variant="full" size={40} color="red" showSubtitle />
            </div>

            <div className="login-greeting">
              <h2>
                {saludo}
                <SaludoIcon periodo={periodo} />
              </h2>
              <p>Ingresa con tu DNI para continuar</p>
            </div>

            <p className="login-info-line">
              <UiIcon name="Info" size={14} />
              El modo de acceso se define con tus credenciales
            </p>

            <form onSubmit={handleLogin} className="login-form">
              <div className="input-group">
                <label htmlFor="dni">DNI</label>
                <div className="login-input-wrap">
                  <span className="login-field-icon" aria-hidden="true">
                    <UiIcon name="User" size={18} />
                  </span>
                  <input
                    type="text"
                    id="dni"
                    name="dni"
                    maxLength="8"
                    value={dni}
                    placeholder="Ingresa tu DNI"
                    onChange={(e) => setDni(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="input-group">
                <div className="label-row">
                  <label htmlFor="password">Contraseña</label>
                  <button
                    type="button"
                    className="forgot-link-btn"
                    onClick={() => setIsModalOpen(true)}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <div className="login-input-wrap">
                  <span className="login-field-icon" aria-hidden="true">
                    <UiIcon name="Lock" size={18} />
                  </span>
                  <PasswordField
                    id="password"
                    value={password}
                    placeholder="Ingresa tu contraseña"
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error && (
                <p className="error-message" role="alert">
                  <UiIcon name="AlertCircle" size={16} />
                  {error}
                </p>
              )}

              <button type="submit" className="btn-submit">
                Ingresar al sistema
              </button>
            </form>
          </div>

          <div className="login-footer">
            <UiIcon name="Shield" size={13} />
            Sesión única · Bloqueo tras 3 intentos fallidos
          </div>

          <p className="login-version">
            LuxFarma v{APP_VERSION}
          </p>
        </div>
      </main>

      {isModalOpen && <ForgotModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}

import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import { esAdmin, esRolCaja } from '../../utils/roles';
import './NoEncontrado.css';

/**
 * Pantalla 404: se muestra cuando la URL no coincide con ninguna ruta.
 * Antes, una ruta inexistente dejaba la pantalla en blanco.
 */
function rutaInicio(user) {
  if (!user) return '/login';
  if (esAdmin(user.id_rol)) return '/admin-dashboard';
  if (esRolCaja(user.id_rol)) return '/dashboard';
  return '/login';
}

export default function NoEncontrado() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inicio = rutaInicio(user);

  return (
    <main className="nf-wrap" role="main" aria-labelledby="nf-titulo">
      <section className="nf-card">
        <LogoLuxFarma variant="icon" size={56} />
        <p className="nf-codigo" aria-hidden="true">404</p>
        <h1 id="nf-titulo" className="nf-titulo">Página no encontrada</h1>
        <p className="nf-texto">
          La dirección <code className="nf-ruta">{pathname}</code> no existe o fue movida.
        </p>
        <div className="nf-acciones">
          <button type="button" className="nf-btn nf-btn--sec" onClick={() => navigate(-1)}>
            Volver atrás
          </button>
          <button type="button" className="nf-btn nf-btn--pri" onClick={() => navigate(inicio, { replace: true })}>
            {user ? 'Ir al inicio' : 'Iniciar sesión'}
          </button>
        </div>
      </section>
    </main>
  );
}

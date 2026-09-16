import { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { limpiarStorageAlLogout } from '../utils/sessionDraft';

const AuthContext = createContext();

export const AuthProvider = ({ children, onLogin, onLogout }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('saludFuturaUser');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const onLoginRef = useRef(onLogin);
  useEffect(() => { onLoginRef.current = onLogin; }, [onLogin]);

  // ← ESTE es el fix: al restaurar sesión desde localStorage, precargar datos
  useEffect(() => {
    if (user && onLoginRef.current) {
      onLoginRef.current(user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar

  const login = useCallback((userData) => {
    setUser(userData);
    localStorage.setItem('saludFuturaUser', JSON.stringify(userData));
    if (onLogin) onLogin(userData);
  }, [onLogin]);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('saludFuturaUser');
    // POS, borradores Compras/Pedidos/Notas, filtro Conteo Físico, turno activo
    limpiarStorageAlLogout();
    if (onLogout) onLogout();
  }, [onLogout]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

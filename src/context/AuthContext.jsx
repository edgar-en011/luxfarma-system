import { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { limpiarStorageAlLogout } from '../utils/sessionDraft';
import { supabase } from '../supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children, onLogin, onLogout }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('luxfarmaUser');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authLoading, setAuthLoading] = useState(true);

  const onLoginRef = useRef(onLogin);
  useEffect(() => { onLoginRef.current = onLogin; }, [onLogin]);

  useEffect(() => {
    let activo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      if (!data.session) {
        setUser(null);
        localStorage.removeItem('luxfarmaUser');
      } else {
        try {
          const guardado = JSON.parse(localStorage.getItem('luxfarmaUser') || 'null');
          if (guardado) onLoginRef.current?.(guardado);
        } catch { /* perfil local inválido */ }
      }
      setAuthLoading(false);
    }).catch(() => { if (activo) setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      setUser(null);
      localStorage.removeItem('luxfarmaUser');
    });
    return () => { activo = false; listener.subscription.unsubscribe(); };
  }, []);

  const login = useCallback((userData) => {
    setUser(userData);
    localStorage.setItem('luxfarmaUser', JSON.stringify(userData));
    if (onLogin) onLogin(userData);
  }, [onLogin]);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('luxfarmaUser');
    void supabase.auth.signOut();
    // POS, borradores Compras/Pedidos/Notas, filtro Conteo Físico, turno activo
    limpiarStorageAlLogout();
    if (onLogout) onLogout();
  }, [onLogout]);

  return (
    <AuthContext.Provider value={{ user, login, logout, authLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppDataProvider, useAppData } from './context/AppDataContext';

import Login from './pages/Login/Login';
import POS from './pages/POS/POS';
import Dashboard from './pages/Dashboard/Dashboard';
import VentasPerdidas from './pages/VentasPerdidas/VentasPerdidas';
import Soporte from './pages/Soporte/Soporte';
import MisVentas from './pages/MisVentas/MisVentas';
import Catalogo from './pages/Catalogo/Catalogo';
import AdminDashboard from './pages/AdminDashboard/AdminDashboard';
import MainLayout from './layouts/MainLayout';
import AdminVentas from './pages/AdminVentas/AdminVentas';
import AdminSunat from './pages/AdminSunat/AdminSunat';
import AdminSeriesSunat from './pages/AdminSeriesSunat/AdminSeriesSunat';
import AdminCodigosProveedor from './pages/AdminCodigosProveedor/AdminCodigosProveedor';
import AdminImpresora from './pages/AdminImpresora/AdminImpresora';
import AdminCompras from './pages/AdminCompras/AdminCompras';
import AdminInventario from './pages/AdminInventario/AdminInventario';
import AdminProductos from './pages/AdminProductos/AdminProductos';
import AdminPedidos from './pages/AdminPedidos/AdminPedidos';
import AdminCuentas from './pages/AdminCuentas/AdminCuentas';
import AdminUsuarios from './pages/AdminUsuarios/AdminUsuarios';
import AdminAlertas from './pages/AdminAlertas/AdminAlertas';
import AdminReportes from './pages/AdminReportes/AdminReportes';
import AdminGanancias from './pages/AdminGanancias/AdminGanancias';
import Kardex from './pages/Kardex/Kardex';
import AdminTomaInventario from './pages/AdminTomaInventario/AdminTomaInventario';
import TomaInventario from './pages/TomaInventario/TomaInventario';
import Notificaciones from './pages/Notificaciones/Notificaciones';
import NoEncontrado from './pages/NoEncontrado/NoEncontrado';
import LogoCargandoOverlay from './components/LogoCargandoOverlay';
import PwaUpdateBanner from './components/PwaUpdateBanner';
import ElectronFunctionKeysToast from './components/ElectronFunctionKeysToast';
import ActualizacionApp from './components/ActualizacionApp';
import { isElectronApp } from './utils/electronBridge';
import { ROL_ADMIN, ROLES_CAJA, ROLES_CAJA_Y_ADMIN, esAdmin, esRolCaja, rolPermitido } from './utils/roles';

// Pantalla de precarga estilo macOS
function AppLoadingScreen() {
  return <LogoCargandoOverlay mensaje="Preparando tu sesión..." />;
}

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user } = useAuth();
  const { appReady, appLoading } = useAppData();

  if (!user) return <Navigate to="/login" replace />;

  // Muestra pantalla de precarga solo si los datos aún no están listos
  if (appLoading || !appReady) return <AppLoadingScreen />;

  if (allowedRoles && !rolPermitido(user.id_rol, allowedRoles)) {
    if (esAdmin(user.id_rol)) return <Navigate to="/admin-dashboard" replace />;
    if (esRolCaja(user.id_rol)) return <Navigate to="/dashboard" replace />;
    return <Navigate to="/login" replace />;
  }
  return children;
};

const RootRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (esAdmin(user.id_rol)) return <Navigate to="/admin-dashboard" replace />;
  if (esRolCaja(user.id_rol)) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/login" replace />;
};

// Wrapper que conecta AuthProvider con AppDataProvider
function AppProviders({ children }) {
  const { precargarDatos, limpiarDatos } = useAppData();
  return (
    <AuthProvider onLogin={precargarDatos} onLogout={limpiarDatos}>
      {children}
    </AuthProvider>
  );
}

function App() {
  // En Electron no montamos PWA (SW); en Chrome sigue igual que hoy.
  // Toast de F-keys: siempre montado (sin rol/ruta). El componente no-op si no hay electronAPI.
  const enElectron = isElectronApp();
  // loadFile() usa file://; BrowserRouter interpreta el path de disco y no
  // matchea /login → pantalla en blanco. HashRouter (#/login) sí funciona.
  const Router = typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? HashRouter
    : BrowserRouter;

  return (
    <AppDataProvider>
      <Router>
        <AppProviders>
          {!enElectron && <PwaUpdateBanner />}
          <ElectronFunctionKeysToast />
          {enElectron && <ActualizacionApp />}
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<Login />} />

            {/* RUTAS DE CAJA — Vendedor (3) y Técnico(a) en Farmacia (4) */}
            <Route element={<ProtectedRoute allowedRoles={ROLES_CAJA}><MainLayout /></ProtectedRoute>}>
              <Route path="/pos" element={<POS />} />
              <Route path="/ventas-perdidas" element={<VentasPerdidas />} />
              <Route path="/soporte" element={<Soporte />} />
              <Route path="/mis-ventas" element={<MisVentas />} />
              <Route path="/catalogo" element={<Catalogo />} />
            </Route>

            {/* RUTAS COMPARTIDAS — Admin + roles de caja:
                - cierre de caja / conteo físico
                - notificaciones: un solo path /notificaciones (el componente adapta por rol) */}
            <Route element={<ProtectedRoute allowedRoles={ROLES_CAJA_Y_ADMIN}><MainLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/toma-inventario" element={<TomaInventario />} />
              <Route path="/notificaciones" element={<Notificaciones />} />
            </Route>

            {/* RUTAS DEL ADMIN */}
            <Route element={<ProtectedRoute allowedRoles={[ROL_ADMIN]}><MainLayout /></ProtectedRoute>}>
              <Route path="/admin-dashboard" element={<AdminDashboard />} />
              <Route path="/admin-pos" element={<POS />} />
              <Route path="/admin-mis-ventas" element={<MisVentas />} />
              <Route path="/admin-ventas" element={<AdminVentas />} />
              <Route path="/admin-sunat" element={<AdminSunat />} />
              <Route path="/admin-series-sunat" element={<AdminSeriesSunat />} />
              <Route path="/admin-codigos-proveedor" element={<AdminCodigosProveedor />} />
              <Route path="/admin-impresora" element={<AdminImpresora />} />
              <Route path="/admin-compras" element={<AdminCompras />} />
              <Route path="/admin-inventario" element={<AdminInventario />} />
              <Route path="/admin-productos" element={<AdminProductos />} />
              <Route path="/admin-pedidos" element={<AdminPedidos />} />
              <Route path="/admin-cuentas" element={<AdminCuentas />} />
              <Route path="/admin-usuarios" element={<AdminUsuarios />} />
              <Route path="/admin-reportes" element={<AdminReportes />} />
              <Route path="/admin-ganancias" element={<AdminGanancias />} />
              <Route path="/admin-alertas" element={<AdminAlertas />} />
              <Route path="/admin-kardex" element={<Kardex />} />
              <Route path="/admin-toma-inventario" element={<AdminTomaInventario />} />
            </Route>

            {/* Cualquier ruta inexistente → pantalla 404 (antes quedaba en blanco) */}
            <Route path="*" element={<NoEncontrado />} />
          </Routes>
        </AppProviders>
      </Router>
    </AppDataProvider>
  );
}

export default App;
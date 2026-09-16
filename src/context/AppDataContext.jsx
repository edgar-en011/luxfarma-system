import { createContext, useState, useContext, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { esAdmin, esRolCaja } from '../utils/roles';

const AppDataContext = createContext();

export const AppDataProvider = ({ children }) => {
  const [appData, setAppData]     = useState(null);
  const [appLoading, setAppLoading] = useState(false);
  const [appReady, setAppReady]   = useState(false);

  const precargarDatos = useCallback(async (user) => {
    if (!user) return;
    setAppLoading(true);
    setAppReady(false);

    try {
      const isAdmin    = esAdmin(user.id_rol);
      const isVendedor = esRolCaja(user.id_rol);

      const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0);
      const hoyFin    = new Date(); hoyFin.setHours(23,59,59,999);

      // Datos comunes para ambos roles
      const [resProductos, resSucursales] = await Promise.all([
        supabase.from('productos')
          .select('id_producto, descripcion, activo, stock_minimo, producto_precios(precio_venta)')
          .eq('activo', 1)
          .limit(500),
        supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo'),
      ]);

      let datosAdmin = {};
      let datosVendedor = {};

      if (isAdmin) {
        const [resVentas, resTurnos, resUsuarios, resTickets, resLotes, resCompras, resNotif] = await Promise.all([
          supabase.from('ventas')
            .select('id_venta, total, created_at, estado_sunat, estado_anulacion, id_usuario_vendedor, id_sucursal, pagos_venta(metodo,monto), venta_detalle(cantidad,subtotal,productos(descripcion))')
            .gte('created_at', hoyInicio.toISOString())
            .lte('created_at', hoyFin.toISOString()),
          supabase.from('caja_turnos')
            .select('id_turno, apertura_at, monto_apertura, id_usuario_vendedor, id_sucursal, usuarios!caja_turnos_id_usuario_vendedor_fkey(nombres,apellidos,activo)')
            .eq('estado', 'ABIERTO'),
          supabase.from('usuarios').select('id_usuario, nombres, apellidos, dni, id_rol, activo, created_at'),
          supabase.from('tickets_soporte').select('id_ticket, estado', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
          // Umbral de stock bajo: stock_minimo o 3, solo productos con movimiento
          // (calcularProductosStockBajo + RPC ids_productos_con_movimiento).
          supabase.from('inventario_lotes')
            .select('id_producto, cantidad_actual, fecha_vencimiento, id_sucursal, estado')
            .eq('estado', 'VIGENTE').gt('cantidad_actual', 0),
          supabase.from('compras')
            .select('total_compra, monto_pagado, fecha_vencimiento, proveedores(razon_social)')
            .not('forma_pago', 'ilike', 'contado').neq('estado_pago', 'PAGADO'),
          supabase.from('notificaciones')
            .select('*')
            .or(`usuario_id.eq.${user.id_usuario},usuario_id.is.null`)
            .order('created_at', { ascending: false })
            .limit(30),
        ]);

        datosAdmin = {
          ventas:        resVentas.data    || [],
          turnos:        resTurnos.data    || [],
          usuarios:      resUsuarios.data  || [],
          ticketsPendientes: resTickets.count || 0,
          lotesAlerta:   resLotes.data     || [],
          compras:       resCompras.data   || [],
          notificaciones: resNotif.data    || [],
        };
      }

      if (isVendedor) {
        const [resVentasVend, resTurnoVend] = await Promise.all([
          supabase.from('ventas')
            .select('id_venta, total, created_at, estado_anulacion')
            .eq('id_usuario_vendedor', user.id_usuario)
            .gte('created_at', hoyInicio.toISOString())
            .lte('created_at', hoyFin.toISOString())
            .order('created_at', { ascending: false }),
          supabase.from('caja_turnos')
            .select('*')
            .eq('id_usuario_vendedor', user.id_usuario)
            .eq('estado', 'ABIERTO')
            .maybeSingle(),
        ]);

        datosVendedor = {
          misVentas:   resVentasVend.data || [],
          turnoActivo: resTurnoVend.data  || null,
        };
      }

      setAppData({
        productos:   resProductos.data  || [],
        sucursales:  resSucursales.data || [],
        cargadoEn:   new Date(),
        ...datosAdmin,
        ...datosVendedor,
      });

      setAppReady(true);
    } catch (err) {
      console.error('Error precargando datos:', err);
      setAppReady(true); // igual dejamos entrar aunque falle
    } finally {
      setAppLoading(false);
    }
  }, []);

  const refrescarSeccion = useCallback(async (seccion) => {
    try {
      const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0);
      const hoyFin    = new Date(); hoyFin.setHours(23,59,59,999);

      if (seccion === 'ventas') {
        const { data } = await supabase.from('ventas')
          .select('id_venta, total, created_at, estado_sunat, estado_anulacion, id_usuario_vendedor, id_sucursal, pagos_venta(metodo,monto), venta_detalle(cantidad,subtotal,productos(descripcion))')
          .gte('created_at', hoyInicio.toISOString())
          .lte('created_at', hoyFin.toISOString());
        setAppData(prev => ({ ...prev, ventas: data || [] }));
      }

      if (seccion === 'notificaciones') {
        const { data } = await supabase.from('notificaciones')
          .select('*').order('created_at', { ascending: false }).limit(30);
        setAppData(prev => ({ ...prev, notificaciones: data || [] }));
      }

      if (seccion === 'productos') {
        const { data } = await supabase.from('productos')
          .select('id_producto, descripcion, activo, stock_minimo, producto_precios(precio_venta)')
          .eq('activo', 1).limit(500);
        setAppData(prev => ({ ...prev, productos: data || [] }));
      }

      if (seccion === 'turnos') {
        const { data } = await supabase.from('caja_turnos')
          .select('id_turno, apertura_at, monto_apertura, id_usuario_vendedor, id_sucursal, usuarios!caja_turnos_id_usuario_vendedor_fkey(nombres,apellidos,activo)')
          .eq('estado', 'ABIERTO');
        setAppData(prev => ({ ...prev, turnos: data || [] }));
      }
    } catch (err) {
      console.error('Error refrescando sección:', err);
    }
  }, []);

  const limpiarDatos = useCallback(() => {
    setAppData(null);
    setAppReady(false);
  }, []);

  return (
    <AppDataContext.Provider value={{ appData, appLoading, appReady, precargarDatos, refrescarSeccion, limpiarDatos }}>
      {children}
    </AppDataContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAppData = () => useContext(AppDataContext);
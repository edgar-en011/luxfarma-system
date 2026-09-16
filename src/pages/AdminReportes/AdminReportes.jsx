import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import './AdminReportes.css';
import SmartDateInput from '../../components/SmartDateInput';
import { fechaLocalStr, hoyLocal } from '../../utils/fechas';
import UiIcon from '../../components/UiIcon';

export default function AdminReportes() {
  useAuth();

  // ================= ESTADOS DE FECHAS (Por defecto: este mes) =================
  const getPrimerDiaMes = () => {
    const d = new Date(); return fechaLocalStr(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const getHoy = () => hoyLocal();

  const [fechaDesde, setFechaDesde] = useState(getPrimerDiaMes());
  const [fechaHasta, setFechaHasta] = useState(getHoy());
  const [sucursalFiltro, setSucursalFiltro] = useState('TODAS');

  // ================= ESTADOS DE BD =================
  const [cargando, setCargando] = useState(false);
  const [errorReporte, setErrorReporte] = useState('');
  const [sucursales, setSucursales] = useState([]);
  const [productos, setProductos] = useState([]);
  
  const [rawVentas, setRawVentas] = useState([]);
  const [rawDetallesVenta, setRawDetallesVenta] = useState([]);
  const [rawCompras, setRawCompras] = useState([]);

  // ================= 1. CARGA ROBUSTA DE DATOS =================
  const cargarReporte = async () => {
    setCargando(true);
    try {
      // 1. Cargar diccionarios si están vacíos
      if (sucursales.length === 0) {
        const [resSuc, resProd] = await Promise.all([
          supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo'),
          supabase.from('productos').select('id_producto, descripcion, codigo_barras')
        ]);
        setSucursales((resSuc.data || []).filter(s => String(s.activo) === '1' || s.activo === true));
        setProductos(resProd.data || []);
      }

      // 2. Rango Perú (-05:00), mismo criterio que AdminVentas / MisVentas.
      // Compras usa fecha_compra (tipo `date`, sin hora) → YYYY-MM-DD tal cual.
      const inicio = new Date(`${fechaDesde}T00:00:00-05:00`).toISOString();
      const fin = new Date(`${fechaHasta}T23:59:59-05:00`).toISOString();

      // 3. Traer Ventas y Compras del rango de fechas
      // Ventas usa created_at (timestamptz). Compras usa fecha_compra (fecha del
      // documento) para alinear con AdminCuentas.jsx.
      const [resVentas, resCompras] = await Promise.all([
        supabase.from('ventas').select('*').gte('created_at', inicio).lte('created_at', fin),
        supabase.from('compras').select('*').gte('fecha_compra', fechaDesde).lte('fecha_compra', fechaHasta)
      ]);

      const ventasData = resVentas.data || [];
      setRawVentas(ventasData);
      setRawCompras(resCompras.data || []);

      // 4. Traer Detalles de Venta (SOLO de las ventas de este rango para no saturar)
      if (ventasData.length > 0) {
        const idsVentas = ventasData.map(v => v.id_venta);
        const { data: detData } = await supabase.from('venta_detalle').select('*').in('id_venta', idsVentas);
        setRawDetallesVenta(detData || []);
      } else {
        setRawDetallesVenta([]);
      }

    } catch (error) {
      console.error("Error al cargar reporte:", error);
      setErrorReporte("Hubo un error al generar el reporte. Intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  // Limpiar error cuando cambian las fechas
  useEffect(() => { setErrorReporte(''); }, [fechaDesde, fechaHasta]);

  // Cargar automáticamente al montar y cuando cambien las fechas
  useEffect(() => { cargarReporte(); }, [fechaDesde, fechaHasta]);

  // ================= 2. PROCESAMIENTO MATEMÁTICO (useMemo) =================
  const datosProcesados = useMemo(() => {
    // A. Excluir anuladas (ventas Y compras — el reporte ya traía estado_anulacion vía
    // select('*'), pero nunca lo revisaba antes de sumar) y filtrar por sucursal si
    // corresponde. exportarReporte() lee todo desde datosProcesados, así que el CSV
    // hereda esto automáticamente sin tocarlo aparte.
    let vFiltradas = rawVentas.filter(v => v.estado_anulacion !== 'ANULADO');
    let cFiltradas = rawCompras.filter(c => c.estado_anulacion !== 'ANULADO');

    if (sucursalFiltro !== 'TODAS') {
      vFiltradas = vFiltradas.filter(v => Number(v.id_sucursal) === Number(sucursalFiltro));
      cFiltradas = cFiltradas.filter(c => Number(c.id_sucursal) === Number(sucursalFiltro));
    }

    // B. KPIs Financieros
    const totalVentas = vFiltradas.reduce((acc, v) => acc + Number(v.total_venta || v.total || 0), 0);
    const totalCompras = cFiltradas.reduce((acc, c) => acc + Number(c.total_compra || 0), 0);
    const balance = totalVentas - totalCompras;
    const ticketPromedio = vFiltradas.length > 0 ? (totalVentas / vFiltradas.length) : 0;

    // C. Top Productos Más Vendidos
    const conteoProductos = {};
    
    // Solo procesamos detalles de las ventas que pasaron el filtro de sucursal
    const idsValidos = new Set(vFiltradas.map(v => v.id_venta));
    const detallesValidos = rawDetallesVenta.filter(d => idsValidos.has(d.id_venta));

    detallesValidos.forEach(d => {
      const idProd = Number(d.id_producto);
      if (!conteoProductos[idProd]) conteoProductos[idProd] = { cantidad: 0, ingresos: 0 };
      conteoProductos[idProd].cantidad += Number(d.cantidad || 0);
      conteoProductos[idProd].ingresos += Number(d.subtotal || 0);
    });

    const topProductos = Object.keys(conteoProductos).map(id => {
      const prod = productos.find(p => Number(p.id_producto) === Number(id));
      return {
        id_producto: id,
        nombre: prod ? prod.descripcion : `Producto ID: ${id}`,
        codigo: prod ? prod.codigo_barras : '---',
        cantidad: conteoProductos[id].cantidad,
        ingresos: conteoProductos[id].ingresos
      };
    }).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10); // Los 10 mejores

    // D. Resumen por Día (Para la gráfica/tabla inferior)
    const resumenDiarioMap = {};
    
    vFiltradas.forEach(v => {
      const dia = new Date(v.fecha_venta || v.created_at).toLocaleDateString('es-PE');
      if (!resumenDiarioMap[dia]) resumenDiarioMap[dia] = { fecha: dia, ventas: 0, compras: 0 };
      resumenDiarioMap[dia].ventas += Number(v.total_venta || v.total || 0);
    });

    cFiltradas.forEach(c => {
      const dia = new Date(c.fecha_compra || c.created_at).toLocaleDateString('es-PE');
      if (!resumenDiarioMap[dia]) resumenDiarioMap[dia] = { fecha: dia, ventas: 0, compras: 0 };
      resumenDiarioMap[dia].compras += Number(c.total_compra || 0);
    });

    const resumenDiario = Object.values(resumenDiarioMap).map(d => ({
      ...d, balance: d.ventas - d.compras
    })).sort((a, b) => {
      // Ordenar por fecha (truco simple para string DD/MM/YYYY)
      const parseDate = (str) => { const [d, m, y] = str.split('/'); return new Date(y, m-1, d); };
      return parseDate(b.fecha) - parseDate(a.fecha); // Más recientes primero
    });

    return { totalVentas, totalCompras, balance, ticketPromedio, cantVentas: vFiltradas.length, topProductos, resumenDiario };

  }, [rawVentas, rawCompras, rawDetallesVenta, sucursalFiltro, productos]);

  // ================= 3. EXPORTAR A EXCEL =================
  const exportarReporte = () => {
    let csv = "REPORTE FINANCIERO SALUD FUTURA\n\n";
    csv += `Rango:;${fechaDesde};hasta;${fechaHasta}\n`;
    csv += `Sucursal:;${sucursalFiltro === 'TODAS' ? 'TODAS' : sucursales.find(s=>s.id_sucursal == sucursalFiltro)?.nombre_comercial}\n\n`;
    
    csv += "INDICADORES GENERALES\n";
    csv += `Ingresos por Ventas;S/ ${datosProcesados.totalVentas.toFixed(2)}\n`;
    csv += `Egresos por Compras;S/ ${datosProcesados.totalCompras.toFixed(2)}\n`;
    csv += `Balance General;S/ ${datosProcesados.balance.toFixed(2)}\n`;
    csv += `Total Operaciones;${datosProcesados.cantVentas} ventas\n\n`;

    csv += "TOP 10 PRODUCTOS MAS VENDIDOS\n";
    csv += "CÓDIGO;PRODUCTO;CANT. VENDIDA;INGRESOS GENERADOS\n";
    datosProcesados.topProductos.forEach(p => {
      csv += `"${p.codigo}";"${p.nombre}";${p.cantidad};S/ ${p.ingresos.toFixed(2)}\n`;
    });

    csv += "\nRESUMEN DIARIO\n";
    csv += "FECHA;INGRESOS;EGRESOS;BALANCE\n";
    datosProcesados.resumenDiario.forEach(d => {
      csv += `${d.fecha};S/ ${d.ventas.toFixed(2)};S/ ${d.compras.toFixed(2)};S/ ${d.balance.toFixed(2)}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Reporte_${fechaDesde}_al_${fechaHasta}.csv`;
    link.click();
  };

  return (
    <div className="rep-container">
      
      {/* CABECERA Y FILTROS */}
      <div className="rep-header-card">
        <div className="rep-title">
          <h2>Análisis y Reportes</h2>
          <p>Métricas financieras y rendimiento de inventario</p>
        </div>

        <div className="rep-filters">
          <div className="rep-date-group">
            <label>Desde:</label>
            <SmartDateInput value={fechaDesde} onChange={(val) => setFechaDesde(val)} />
          </div>
          <div className="rep-date-group">
            <label>Hasta:</label>
            <SmartDateInput value={fechaHasta} onChange={(val) => setFechaHasta(val)} />
          </div>
          <div className="rep-date-group">
            <label>Sede:</label>
            <select value={sucursalFiltro} onChange={e => setSucursalFiltro(e.target.value)}>
              <option value="TODAS">Todas las Sedes</option>
              {sucursales.map(s => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>)}
            </select>
          </div>
          <button className="btn-rep-exportar" onClick={exportarReporte}><UiIcon name="Download" size={15} /> Exportar a Excel</button>
        </div>
      </div>

      {cargando ? (
        <div className="admin-loading">Generando cálculos financieros...</div>
      ) : errorReporte ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#b91c1c', background: '#fef2f2', borderRadius: '12px', margin: '1rem 0' }}>
          <p style={{ fontSize: '1.5rem' }}><UiIcon name="AlertTriangle" size={16} /></p>
          <p style={{ fontWeight: 'bold' }}>{errorReporte}</p>
          <button onClick={cargarReporte} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', background: '#b91c1c', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Reintentar</button>
        </div>
      ) : (
        <>
          {/* TARJETAS KPI */}
          <div className="rep-kpi-grid">
            <div className="rkpi-card">
              <p>INGRESOS POR VENTAS</p>
              <h2 className="text-green">S/ {datosProcesados.totalVentas.toLocaleString('en-US', {minimumFractionDigits: 2})}</h2>
              <span>{datosProcesados.cantVentas} transacciones</span>
            </div>
            <div className="rkpi-card">
              <p>EGRESOS POR COMPRAS</p>
              <h2 className="text-red">S/ {datosProcesados.totalCompras.toLocaleString('en-US', {minimumFractionDigits: 2})}</h2>
              <span>Inversión en mercadería</span>
            </div>
            <div className={`rkpi-card ${datosProcesados.balance >= 0 ? 'bg-soft-green' : 'bg-soft-red'}`}>
              <p>BALANCE (FLUJO DE CAJA)</p>
              <h2 className={datosProcesados.balance >= 0 ? 'text-green' : 'text-red'}>
                {datosProcesados.balance >= 0 ? '+' : ''} S/ {datosProcesados.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}
              </h2>
              <span>Ingresos menos Egresos</span>
            </div>
            <div className="rkpi-card">
              <p>TICKET PROMEDIO</p>
              <h2 className="text-dark">S/ {datosProcesados.ticketPromedio.toLocaleString('en-US', {minimumFractionDigits: 2})}</h2>
              <span>Gasto promedio por cliente</span>
            </div>
          </div>

          <div className="rep-grid-2-col">
            {/* TOP PRODUCTOS */}
            <div className="rep-box">
              <div className="rep-box-header">
                <h3><UiIcon name="Trophy" size={16} /> Top 10 Productos Más Vendidos</h3>
              </div>
              <div className="rep-table-wrap">
                <table className="rep-table">
                  <thead><tr><th>PRODUCTO</th><th className="text-center">CANT. VENDIDA</th><th className="text-right">INGRESOS</th></tr></thead>
                  <tbody>
                    {datosProcesados.topProductos.length === 0 ? (
                      <tr><td colSpan="3" className="empty-rep">No hay ventas registradas en este periodo.</td></tr>
                    ) : (
                      datosProcesados.topProductos.map((p, i) => (
                        <tr key={i}>
                          <td><strong>{p.nombre}</strong><br/><small className="text-muted">Cód: {p.codigo}</small></td>
                          <td className="text-center"><span className="badge-cant">{p.cantidad} unds</span></td>
                          <td className="text-right font-bold text-green">S/ {p.ingresos.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RESUMEN DIARIO */}
            <div className="rep-box">
              <div className="rep-box-header">
                <h3><UiIcon name="Calendar" size={15} /> Flujo de Caja por Día</h3>
              </div>
              <div className="rep-table-wrap">
                <table className="rep-table">
                  <thead><tr><th>FECHA</th><th className="text-right">INGRESOS</th><th className="text-right">EGRESOS</th><th className="text-right">BALANCE</th></tr></thead>
                  <tbody>
                    {datosProcesados.resumenDiario.length === 0 ? (
                      <tr><td colSpan="4" className="empty-rep">No hay movimientos financieros en este periodo.</td></tr>
                    ) : (
                      datosProcesados.resumenDiario.map((d, i) => (
                        <tr key={i}>
                          <td className="font-bold text-dark">{d.fecha}</td>
                          <td className="text-right text-green">S/ {d.ventas.toFixed(2)}</td>
                          <td className="text-right text-red">S/ {d.compras.toFixed(2)}</td>
                          <td className={`text-right font-bold ${d.balance >= 0 ? 'text-green' : 'text-red'}`}>
                            {d.balance >= 0 ? '+' : ''}{d.balance.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
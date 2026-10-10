import { useState, useEffect, useCallback, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { supabase } from '../../supabaseClient';
import './AdminInventario.css';
import { useLocation } from 'react-router-dom';
import ProductoFormModal from '../../components/ProductoFormModal';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { formatSolesUnitario } from '../../utils/precioExacto';
import { porcentajeGanancia, formatearPorcentajeGanancia } from '../../utils/porcentajeGanancia';
import { diasHastaFecha, formatearFechaPE, parseFechaISO } from '../../utils/fechas';
import { estaPorVencer } from '../../utils/umbralesVencimiento';
import { marcarLotesVencidos } from '../../utils/lotesVencidos';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento } from '../../utils/stockBajo';
import { fetchLaboratorios, suscribirLaboratoriosChanged } from '../../utils/laboratoriosCatalogo';
import { marcarCatalogoOfflineStale } from '../../utils/catalogoCache';
import { formatearEquivalenciaStock } from '../../utils/equivalenciaStock';
import UiIcon from '../../components/UiIcon';

/** Trae todas las filas de una query Supabase paginando de a 1000. */
async function fetchAllRows(buildQuery) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return all;
}

export default function AdminInventario() {
  const location = useLocation();

  // ── Catálogos auxiliares ────────────────────────────────────────
  const [sucursales, setSucursales] = useState([]);
  const [diccionarios, setDiccionarios] = useState({ familias: [], laboratorios: [], presentaciones: [] });
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);

  // ── Datos paginados ─────────────────────────────────────────────
  const [productos, setProductos] = useState([]);
  const [totalProductos, setTotalProductos] = useState(0);
  const [cargandoTabla, setCargandoTabla] = useState(false);

  // ── KPIs globales (catálogo completo; independientes del filtro de la tabla) ─
  const [kpis, setKpis] = useState({ totalCatalogo: 0, stockBajo: 0, vencidos: 0, valorInv: 0 });

  // ── Filtros ─────────────────────────────────────────────────────
  const [busqueda, setBusqueda] = useState(location.state?.busquedaPredefinida || '');
  const [busquedaInput, setBusquedaInput] = useState(location.state?.busquedaPredefinida || '');
  const [sucursalFiltro, setSucursalFiltro] = useState('TODAS');
  const [categoriaFiltro, setCategoriaFiltro] = useState('TODAS');
  const [estadoFiltro, setEstadoFiltro] = useState('TODOS');
  const [ordenFiltro, setOrdenFiltro] = useState('NOMBRE_ASC');
  const [paginaActual, setPaginaActual] = useState(1);
  const [filasPorPagina, setFilasPorPagina] = useState(12);

  // ── Modal ───────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [productoEnEdicion, setProductoEnEdicion] = useState(null);

  // ── Alertas ─────────────────────────────────────────────────────
  const [alertaSistema, setAlertaSistema] = useState(null);
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);

  // ── 1. Cargar catálogos auxiliares (una sola vez + refresh labs) ─
  useEffect(() => {
    const init = async () => {
      setCargandoCatalogos(true);
      try {
        const { data: dataSuc } = await supabase.from('sucursales').select('*');
        setSucursales((dataSuc || []).filter(s => String(s.activo) === '1' || s.activo === true));

        const [resFam, labs, resPres] = await Promise.all([
          supabase.from('familias').select('*'),
          fetchLaboratorios(),
          supabase.from('presentaciones').select('*')
        ]);
        setDiccionarios({
          familias: (resFam.data || []).filter(f => String(f.activo) === '1' || f.activo === true),
          laboratorios: labs.filter(l => String(l.activo) === '1' || l.activo === true),
          presentaciones: (resPres.data || []).filter(p => String(p.activo) === '1' || p.activo === true),
        });
      } finally {
        setCargandoCatalogos(false);
      }
    };
    init();
  }, []);

  useEffect(() => suscribirLaboratoriosChanged(async () => {
    try {
      const labs = await fetchLaboratorios();
      setDiccionarios(prev => ({
        ...prev,
        laboratorios: labs.filter(l => String(l.activo) === '1' || l.activo === true),
      }));
    } catch {
      /* ignore */
    }
  }), []);

  // ── 2. Cargar página de productos (cuando cambian filtros/página) ─
  const cargarPagina = useCallback(async () => {
    setCargandoTabla(true);
    try {
      await marcarLotesVencidos();

      const desde = (paginaActual - 1) * filasPorPagina;
      const hasta = desde + filasPorPagina - 1;

      let q = supabase
        .from('productos')
        .select('*, producto_precios(costo, precio_venta), producto_formas_venta(factor, activo, unidades_medida(nombre)), inventario_lotes(cantidad_actual, costo_unitario_lote, fecha_vencimiento, estado, id_sucursal)', { count: 'exact' })
        .eq('activo', 1);

      if (busqueda.trim()) {
        // "," y "(" / ")" rompen el mini-lenguaje de .or() de PostgREST (mismo fix ya
        // aplicado en POS.jsx) — se reemplazan por espacio para no cortar la búsqueda.
        const terminoSeguro = busqueda.trim().replace(/[,()]/g, " ");
        q = q.or(`descripcion.ilike.%${terminoSeguro}%,codigo_barras.ilike.%${terminoSeguro}%`);
      }
      if (categoriaFiltro !== 'TODAS') q = q.eq('id_familia', categoriaFiltro);

      const orderCol = ordenFiltro.startsWith('NOMBRE') ? 'descripcion' : 'descripcion';
      q = q.order(orderCol, { ascending: ordenFiltro === 'NOMBRE_ASC' || ordenFiltro === 'MAYOR_STOCK' });
      q = q.range(desde, hasta);

      const { data, count, error } = await q;
      if (error) throw error;

      // Procesar stock por producto
      const procesados = (data || []).map(prod => {
        const lotes = (prod.inventario_lotes || []).filter(l =>
          ['VIGENTE', 'VENCIDO'].includes(l.estado) &&
          (sucursalFiltro === 'TODAS' || Number(l.id_sucursal) === Number(sucursalFiltro))
        );

        let stockTotal = 0, valorTotal = 0, fechaProxima = null;
        lotes.forEach(l => {
          const qty = Number(l.cantidad_actual || 0);
          stockTotal += qty;
          valorTotal += qty * Number(l.costo_unitario_lote || 0);
          if (qty > 0 && l.fecha_vencimiento) {
            const fv = parseFechaISO(l.fecha_vencimiento)?.iso;
            if (fv && (!fechaProxima || fv < fechaProxima)) fechaProxima = fv;
          }
        });

        let estadoVenc = 'EN STOCK';
        if (fechaProxima) {
          const dias = diasHastaFecha(fechaProxima);
          if (dias != null && dias < 0) estadoVenc = 'VENCIDO';
          else if (estaPorVencer(dias)) estadoVenc = 'POR VENCER';
        }

        const filaPrecio = filaProductoPrecios(prod.producto_precios);
        const costo = Number(filaPrecio?.costo || 0);
        const pVenta = Number(filaPrecio?.precio_venta || 0);
        const margen = porcentajeGanancia(pVenta, costo);
        const labObj = diccionarios.laboratorios.find(l => Number(l.id_laboratorio) === Number(prod.id_laboratorio));
        const famObj = diccionarios.familias.find(f => Number(f.idfamilia) === Number(prod.id_familia));

        return {
          ...prod,
          stockTotal, valorTotalAlmacen: valorTotal,
          equivalenciaStock: formatearEquivalenciaStock(stockTotal, prod.producto_formas_venta),
          fechaVencimiento: fechaProxima,
          estadoVencimiento: estadoVenc,
          costo, pVenta, margen, minStock: 20,
          nombreLaboratorio: labObj?.nombre || 'Genérico',
          nombreFamilia: famObj?.nombre || null,
        };
      });

      // Filtro post-carga para stock_bajo / vencidos (no se puede hacer en Supabase fácilmente)
      let filtrados = procesados;
      if (estadoFiltro === 'STOCK_BAJO') filtrados = procesados.filter(p => p.stockTotal <= p.minStock && p.stockTotal > 0);
      if (estadoFiltro === 'VENCIDOS') filtrados = procesados.filter(p => p.estadoVencimiento === 'VENCIDO');
      if (estadoFiltro === 'POR_VENCER') filtrados = procesados.filter(p => p.estadoVencimiento === 'POR VENCER');

      setProductos(filtrados);
      setTotalProductos(count || 0);
    } catch (err) {
      mostrarAlerta('Error al cargar productos: ' + err.message, 'error');
    } finally {
      setCargandoTabla(false);
    }
  }, [paginaActual, filasPorPagina, busqueda, sucursalFiltro, categoriaFiltro, estadoFiltro, ordenFiltro, diccionarios]);

  useEffect(() => {
    if (!cargandoCatalogos) cargarPagina();
  }, [cargarPagina, cargandoCatalogos]);

  // ── 3. KPIs en segundo plano (no bloquean la tabla) ─────────────
  const cargarKpis = useCallback(async () => {
    try {
      await marcarLotesVencidos();

      const [productosActivos, lotes, idsMovimiento] = await Promise.all([
        fetchAllRows(() =>
          supabase.from('productos').select('id_producto, stock_minimo').eq('activo', 1)
        ),
        fetchAllRows(() =>
          supabase
            .from('inventario_lotes')
            .select('id_producto, id_sucursal, cantidad_actual, costo_unitario_lote, estado')
            .in('estado', ['VIGENTE', 'VENCIDO'])
        ),
        cargarIdsProductosConMovimiento(),
      ]);

      const stockBajoItems = calcularProductosStockBajo(productosActivos, lotes, idsMovimiento);
      // Productos distintos bajo mínimo (la pantalla es por producto, no por sede).
      const stockBajo = new Set(stockBajoItems.map((i) => Number(i.id_producto))).size;

      // Lotes ya marcados VENCIDO (tras marcarLotesVencidos) con stock > 0.
      const vencidos = lotes.filter(
        (l) => l.estado === 'VENCIDO' && Number(l.cantidad_actual || 0) > 0
      ).length;

      // Valor = cantidad × costo de lote (VIGENTE + VENCIDO, mismo criterio que la tabla).
      const valorInv = lotes.reduce((acc, l) => {
        const qty = Number(l.cantidad_actual || 0);
        if (qty <= 0) return acc;
        return acc + qty * Number(l.costo_unitario_lote || 0);
      }, 0);

      setKpis({
        totalCatalogo: productosActivos.length,
        stockBajo,
        vencidos,
        valorInv,
      });
    } catch (err) {
      console.error('Error cargando KPIs de inventario:', err);
    }
  }, []);

  useEffect(() => {
    cargarKpis();
  }, [cargarKpis]);

  // ── Debounce búsqueda ───────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(busquedaInput); setPaginaActual(1); }, 400);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  const totalPaginas = Math.ceil(totalProductos / filasPorPagina);
  const indexOfFirst = (paginaActual - 1) * filasPorPagina + 1;
  const indexOfLast = Math.min(paginaActual * filasPorPagina, totalProductos);

  const getPageNumbers = () => {
    const maxPages = 5;
    let start = Math.max(1, paginaActual - Math.floor(maxPages / 2));
    let end = Math.min(totalPaginas, start + maxPages - 1);
    if (end - start + 1 < maxPages) start = Math.max(1, end - maxPages + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  // ── Exportar (trae todos para CSV) ──────────────────────────────
  const exportarExcel = async () => {
    mostrarAlerta('Preparando exportación...', 'info');
    try {
      const allData = await fetchAllRows(() =>
        supabase
          .from('productos')
          .select('*, producto_precios(costo, precio_venta), inventario_lotes(cantidad_actual, estado)')
          .eq('activo', 1)
      );
      const encabezados = "CÓDIGO,PRODUCTO,STOCK,P.COSTO,P.VENTA\n";
      const filas = allData.map((p) => {
        const fp = filaProductoPrecios(p.producto_precios);
        const stock = (p.inventario_lotes || [])
          .filter((l) => ['VIGENTE', 'VENCIDO'].includes(l.estado))
          .reduce((acc, l) => acc + Number(l.cantidad_actual || 0), 0);
        return `"${p.codigo_barras || ''}","${p.descripcion}",${stock},${fp?.costo || 0},${fp?.precio_venta || 0}`;
      }).join("\n");
      const blob = new Blob(["\uFEFF" + encabezados + filas], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Inventario_LuxFarma.csv`; link.click();
      setAlertaSistema(null);
    } catch (err) { mostrarAlerta('Error al exportar: ' + err.message, 'error'); }
  };

  // ── Modal nuevo / editar ─────────────────────────────────────────
  const abrirModalNuevo = () => {
    setModoEdicion(false);
    setProductoEnEdicion(null);
    setShowModal(true);
  };

  const abrirModalEditar = (prod) => {
    setModoEdicion(true);
    setProductoEnEdicion(prod);
    setShowModal(true);
  };

  const handleEliminarProducto = (id) => {
    mostrarAlerta("¿Estás seguro de ocultar este producto del inventario?", "warning", async () => {
      try {
        const { data, error } = await supabase
          .from('productos')
          .update({ activo: 0 })
          .eq('id_producto', id)
          .select('id_producto');
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('No se pudo ocultar el producto (0 filas actualizadas).');
        }
        marcarCatalogoOfflineStale();
        mostrarAlerta("Producto eliminado.", "success");
        cargarPagina();
        cargarKpis();
      } catch (error) { mostrarAlerta("Error: " + error.message, "error"); }
    }, "Sí, eliminar", () => {}, "Cancelar");
  };

  const getCategoriaColor = (n) => {
    if (!n) return 'bg-gray';
    const nl = n.toLowerCase();
    if (nl.includes('analgesico') || nl.includes('anti')) return 'pill-blue';
    if (nl.includes('gastro') || nl.includes('vita')) return 'pill-green';
    if (nl.includes('cardio') || nl.includes('diab')) return 'pill-orange';
    return 'pill-purple';
  };

  if (cargandoCatalogos) return <div className="admin-loading">Conectando con la base de datos...</div>;

  return (
    <div className="admin-inv-container">

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      <ProductoFormModal
        visible={showModal}
        modo={modoEdicion ? 'editar' : 'nuevo'}
        productoInicial={productoEnEdicion}
        onClose={() => setShowModal(false)}
        onGuardado={() => { cargarPagina(); cargarKpis(); }}
        mostrarAlerta={mostrarAlerta}
      />

      <div className="inv-top-actions">
        <div className="inv-title-area"><p>{kpis.totalCatalogo.toLocaleString()} productos en catálogo global</p></div>
        <div className="inv-buttons-area">
          <button className="btn-inv-outline" onClick={exportarExcel}><UiIcon name="Download" size={15} /> Exportar Excel</button>
          <button className="btn-inv-primary" onClick={abrirModalNuevo}>+ Nuevo producto</button>
        </div>
      </div>

      <div className="inv-kpis-grid">
        <div className="inv-kpi-card border-blue"><div className="kpi-icon bg-brand-soft"><UiIcon name="FileText" size={16} /></div><div className="kpi-info"><p>TOTAL PRODUCTOS</p><h2>{kpis.totalCatalogo.toLocaleString()}</h2><span>en catálogo</span></div></div>
        <div className="inv-kpi-card border-yellow"><div className="kpi-icon bg-yellow-soft"><UiIcon name="AlertTriangle" size={16} /></div><div className="kpi-info"><p>STOCK BAJO</p><h2>{kpis.stockBajo}</h2><span>bajo mínimo</span></div></div>
        <div className="inv-kpi-card border-red"><div className="kpi-icon bg-red-soft"><UiIcon name="XCircle" size={16} /></div><div className="kpi-info"><p>VENCIDOS</p><h2>{kpis.vencidos}</h2><span>requieren acción</span></div></div>
        <div className="inv-kpi-card border-green"><div className="kpi-icon bg-green-soft"><UiIcon name="Package" size={16} /></div><div className="kpi-info"><p>VALOR INVENTARIO</p><h2>S/ {kpis.valorInv.toLocaleString('en-US', { minimumFractionDigits: 2 })}</h2><span>costo total</span></div></div>
      </div>

      <div className="inv-filters-bar">
        <div className="search-box-inv"><span><UiIcon name="Search" size={16} /></span><input type="text" placeholder="Buscar nombre o código..." value={busquedaInput} onChange={e => setBusquedaInput(e.target.value)} /></div>
        <select className="select-inv-sucursal" value={sucursalFiltro} onChange={e => { setSucursalFiltro(e.target.value); setPaginaActual(1); }}><option value="TODAS">Todas las sedes</option>{sucursales.map(s => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>)}</select>
        <select className="select-inv-sucursal" value={categoriaFiltro} onChange={e => { setCategoriaFiltro(e.target.value); setPaginaActual(1); }}><option value="TODAS">Todas las categorías</option>{diccionarios.familias.map(f => <option key={f.idfamilia} value={f.idfamilia}>{f.nombre}</option>)}</select>
        <div className="inv-pills-group">
          <button className={`pill-btn ${estadoFiltro === 'TODOS' ? 'active dark' : ''}`} onClick={() => { setEstadoFiltro('TODOS'); setPaginaActual(1); }}>Todos</button>
          <button className={`pill-btn ${estadoFiltro === 'STOCK_BAJO' ? 'active yellow' : ''}`} onClick={() => { setEstadoFiltro('STOCK_BAJO'); setPaginaActual(1); }}><span className="dot-yellow"></span> Stock bajo</button>
          <button className={`pill-btn ${estadoFiltro === 'VENCIDOS' ? 'active red' : ''}`} onClick={() => { setEstadoFiltro('VENCIDOS'); setPaginaActual(1); }}><span className="dot-red"></span> Vencidos</button>
          <button className={`pill-btn ${estadoFiltro === 'POR_VENCER' ? 'active orange' : ''}`} onClick={() => { setEstadoFiltro('POR_VENCER'); setPaginaActual(1); }}><span className="dot-orange"></span> Por vencer</button>
        </div>
        <select className="select-inv-sort" value={ordenFiltro} onChange={e => setOrdenFiltro(e.target.value)}><option value="NOMBRE_ASC">Nombre A-Z</option><option value="NOMBRE_DESC">Nombre Z-A</option></select>
      </div>

      <div className="inv-table-container" style={{ position: 'relative' }}>
        {cargandoTabla && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 8 }}>
            <span style={{ color: 'var(--lf-primary)', fontWeight: 600 }}>Cargando...</span>
          </div>
        )}
        <table className="inv-table">
          <thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th className="text-center">STOCK ⇅</th><th className="text-center">MÍNIMO</th><th className="text-center">P. COSTO</th><th className="text-center">P. VENTA</th><th className="text-center">MARGEN</th><th>VENCIMIENTO</th><th className="text-center">ACCIONES</th></tr></thead>
          <tbody>
            {productos.length === 0 && !cargandoTabla ? (
              <tr><td colSpan="9" className="empty-inv">No se encontraron productos con estos filtros.</td></tr>
            ) : (
              productos.map(p => {
                const stockColor = p.stockTotal <= p.minStock ? 'bg-red' : p.stockTotal <= (p.minStock * 2) ? 'bg-yellow' : 'bg-green';
                const pctStock = Math.min(100, (p.stockTotal / (p.minStock * 5)) * 100) || 0;
                const statusVencColor = p.estadoVencimiento === 'VENCIDO' ? 'text-red' : p.estadoVencimiento === 'POR VENCER' ? 'text-orange' : 'text-green';
                return (
                  <tr key={p.id_producto}>
                    <td><strong className="text-dark">{p.descripcion}</strong><br /><small className="text-muted">{p.nombreLaboratorio} · Cód: {p.codigo_barras || '---'}</small></td>
                    <td><span className={`cat-pill ${getCategoriaColor(p.nombreFamilia)}`}><span className="dot"></span> {p.nombreFamilia || 'Sin categoría'}</span></td>
                    <td className="text-center inv-stock-cell">
                      <strong className={stockColor.replace('bg-', 'text-')}>{p.stockTotal} unidades</strong>
                      {p.equivalenciaStock && <small className="inv-stock-equivalence">Equivalencia: {p.equivalenciaStock}</small>}
                      <div className="inv-bar-bg"><div className={`inv-bar-fill ${stockColor}`} style={{ width: `${pctStock}%` }}></div></div>
                    </td>
                    <td className="text-center text-muted">{p.minStock}</td>
                    <td className="text-center text-muted">{formatSolesUnitario(p.costo)}</td>
                    <td className="text-center font-bold text-dark">{formatSolesUnitario(p.pVenta)}</td>
                    <td className="text-center"><strong className="text-green">{formatearPorcentajeGanancia(p.pVenta, p.costo)}</strong><div className="inv-bar-bg"><div className="inv-bar-fill bg-green" style={{ width: `${Math.max(0, Math.min(100, p.margen ?? 0))}%` }}></div></div></td>
                    <td><span className="text-dark">{p.fechaVencimiento ? formatearFechaPE(p.fechaVencimiento) : '---'}</span><br /><small className={`font-bold ${statusVencColor}`}>{p.estadoVencimiento}</small></td>
                    <td className="text-center actions-cell">
                      <button type="button" className="btn-icon-edit" onClick={() => abrirModalEditar(p)}><UiIcon name="Pencil" size={16} /></button>
                      <button type="button" className="btn-icon-delete" onClick={() => handleEliminarProducto(p.id_producto)}><UiIcon name="Trash2" size={16} /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="inv-pagination">
          <span className="text-muted">Mostrando <strong>{productos.length === 0 ? 0 : indexOfFirst} - {indexOfLast}</strong> de <strong>{totalProductos.toLocaleString()}</strong></span>
          <div className="page-controls">
            <button disabled={paginaActual === 1} onClick={() => setPaginaActual(1)}>«</button>
            <button disabled={paginaActual === 1} onClick={() => setPaginaActual(p => p - 1)}>‹</button>
            {getPageNumbers().map(num => <button key={num} className={paginaActual === num ? 'active' : ''} onClick={() => setPaginaActual(num)}>{num}</button>)}
            <button disabled={paginaActual === totalPaginas || totalPaginas === 0} onClick={() => setPaginaActual(p => p + 1)}>›</button>
            <button disabled={paginaActual === totalPaginas || totalPaginas === 0} onClick={() => setPaginaActual(totalPaginas)}>»</button>
          </div>
          <div className="page-rows">
            <span className="text-muted">Filas por pág: </span>
            <select value={filasPorPagina} onChange={e => { setFilasPorPagina(Number(e.target.value)); setPaginaActual(1); }}>
              <option value={12}>12</option><option value={24}>24</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

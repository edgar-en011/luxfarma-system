import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { formatPrecioUnitario } from '../../utils/precioExacto';
import { formatearEquivalenciaStock } from '../../utils/equivalenciaStock';
import { loteDisponible, cantidadLote } from '../../utils/stockLotes';
import './Catalogo.css';
import UiIcon from '../../components/UiIcon';

export default function Catalogo() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [busquedaRealizada, setBusquedaRealizada] = useState(false);

  const formatearVencimiento = (fecha) => {
    if (!fecha) return 'Sin fecha';
    const partes = fecha.split('-');
    if (partes.length < 2) return fecha;
    return `${partes[1]}/${partes[0]}`;
  };

  const handleSearchChange = async (e) => {
    const termino = e.target.value;
    setSearchTerm(termino);

    if (termino.trim().length < 2) {
      setResultados([]);
      setBusquedaRealizada(false);
      return;
    }

    setBuscando(true);
    setBusquedaRealizada(true);

    try {
      const terminoSeguro = termino.trim().replace(/[,()]/g, " ");
      const { data, error } = await supabase
        .from('productos')
        .select(`
          id_producto, codigo_barras, descripcion, fraccion,
          producto_precios (precio_venta),
          producto_formas_venta (factor, activo, unidades_medida(nombre))
        `)
        .or(`codigo_barras.ilike.%${terminoSeguro}%,descripcion.ilike.%${terminoSeguro}%`)
        .eq('activo', 1)
        .order('descripcion', { ascending: true })
        .limit(20);
      if (error) throw error;

      const ids = (data || []).map(p => p.id_producto);

      let lotesData = [];
      if (ids.length > 0) {
        let lotesQuery = supabase
          .from('inventario_lotes')
          .select('id_producto, nro_lote, fecha_vencimiento, cantidad_actual, estado')
          .in('id_producto', ids)
          .eq('estado', 'VIGENTE')
          .gt('cantidad_actual', 0);

        // Filtrar por sucursal solo si el usuario tiene una asignada
        if (user?.id_sucursal) {
          lotesQuery = lotesQuery.eq('id_sucursal', user.id_sucursal);
        }

        const { data: ld } = await lotesQuery;
        lotesData = ld || [];
      }

      const lotesMap = {};
      lotesData.forEach(l => {
        if (!lotesMap[l.id_producto]) lotesMap[l.id_producto] = [];
        lotesMap[l.id_producto].push(l);
      });

      const processedData = (data || []).map(prod => {
        const activeLots = (lotesMap[prod.id_producto] || []).filter((lote) => loteDisponible(lote))
          .sort((a, b) => {
            if (!a.fecha_vencimiento) return 1;
            if (!b.fecha_vencimiento) return -1;
            return new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento);
          });
        const totalStock = activeLots.reduce((sum, lot) => sum + cantidadLote(lot), 0);
        return {
          ...prod,
          lotesActivos: activeLots,
          totalStock,
          equivalenciaStock: formatearEquivalenciaStock(totalStock, prod.producto_formas_venta),
          precio_base: formatPrecioUnitario(filaProductoPrecios(prod.producto_precios)?.precio_venta || 0),
        };
      });

      setResultados(processedData);
    } catch (error) {
      console.error("Error buscando en catálogo:", error);
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="cat-container">

      <div className="cat-header-banner">
        <div className="cat-header-content">
          <h2>Catálogo y Consulta de Precios</h2>
          <p>Busca rápidamente productos, verifica el stock en estante y los precios sin necesidad de abrir una venta.</p>

          <div className="cat-search-form">
            <div className="cat-search-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Código de barras o nombre del producto..."
                value={searchTerm}
                onChange={handleSearchChange}
                autoFocus
              />
            </div>
          </div>
        </div>
      </div>

      <div className="cat-results-area">
        {buscando ? (
          <div className="cat-loading">
            <div className="cat-spinner"></div>
            <p>Consultando base de datos...</p>
          </div>
        ) : busquedaRealizada && resultados.length === 0 ? (
          <div className="cat-empty">
            <span className="cat-empty-icon"><UiIcon name="Package" size={16} /></span>
            <h3>No se encontraron resultados</h3>
            <p>No hay ningún producto que coincida con "{searchTerm}". Verifica que esté bien escrito o regístralo como Venta Perdida si el cliente lo solicitó.</p>
          </div>
        ) : (
          <div className="cat-grid">
            {resultados.map((item) => (
              <div key={item.id_producto} className="cat-card">
                <div className="cat-card-top">
                  <span className="cat-barcode">{item.codigo_barras || 'Sin código'}</span>
                  <span className={`cat-stock-badge ${item.totalStock > 20 ? 'green' : item.totalStock > 0 ? 'yellow' : 'red'}`}>
                    {item.totalStock > 0 ? `Stock disponible: ${item.totalStock} unidades` : 'Agotado'}
                  </span>
                </div>

                <h3 className="cat-prod-title">{item.descripcion}</h3>

                {item.equivalenciaStock && (
                  <p className="cat-stock-equivalence">
                    <span>Equivalencia:</span> {item.equivalenciaStock}
                  </p>
                )}

                <div className="cat-price-box">
                  <span className="cat-currency">S/</span>
                  <span className="cat-price">{item.precio_base}</span>
                </div>

                <div className="cat-lotes-list">
                  <p className="cat-lotes-title">Lotes disponibles (FEFO):</p>
                  {item.lotesActivos.length > 0 ? (
                    item.lotesActivos.map((lote, i) => (
                      <div key={i} className="cat-lote-item">
                        <span>Lote: {lote.nro_lote || 'Sin lote'}</span>
                        <span>Vence: {formatearVencimiento(lote.fecha_vencimiento)}</span>
                        <span>({lote.cantidad_actual} und)</span>
                      </div>
                    ))
                  ) : (
                    <div className="cat-lote-item empty">Sin lotes activos.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

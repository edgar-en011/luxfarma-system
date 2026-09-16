import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import UiIcon from './UiIcon';
import { formatSolesUnitario } from '../utils/precioExacto';
import { formatearPorcentajeGanancia } from '../utils/porcentajeGanancia';

// Sección reutilizable "Formas de Venta y Precios" — usada tanto en el modal
// "Modificar precio de venta" como en "Agregar producto a la compra".
// Maneja su propio catálogo de unidades y su propia lista de formas por producto,
// para no duplicar estados/funciones entre ambos modales.
export default function TablaFormasVenta({ idProducto, mostrarAlerta, costoActualIngresado, onFormaGuardada, refrescarSenal, mensajeVacio, formasPrecargadas }) {
  const [catalogoUnidades, setCatalogoUnidades] = useState([]);
  const [formasVenta, setFormasVenta] = useState([]);
  const [nuevaForma, setNuevaForma] = useState({ id_medida: '', factor: 1, p_compra: '', precio_venta: '' });

  // showModalForma controla el modal de creación/edición; formaEnEdicion es
  // null cuando se está creando una forma nueva, u objeto con la fila original cuando se edita.
  const [showModalForma, setShowModalForma] = useState(false);
  const [formaEnEdicion, setFormaEnEdicion] = useState(null);
  const precioVentaFormaRef = useRef(null);
  const unidadFormaRef = useRef(null);

  useEffect(() => {
    const cargarUnidades = async () => {
      const { data } = await supabase.from('unidades_medida').select('*').eq('activo', 1).order('id_medida');
      setCatalogoUnidades(data || []);
    };
    cargarUnidades();
  }, []);

  const cargarFormasVenta = async (idProd) => {
    const { data } = await supabase
      .from('producto_formas_venta')
      .select('*, unidades_medida(nombre)')
      .eq('id_producto', idProd)
      .eq('activo', true)
      .order('orden');
    setFormasVenta(data || []);
  };

  useEffect(() => {
    setNuevaForma({ id_medida: '', factor: 1, p_compra: '', precio_venta: '' });
    setFormaEnEdicion(null);
    setShowModalForma(false);
    if (formasPrecargadas) {
      setFormasVenta(formasPrecargadas);
      return;
    }
    if (idProducto) cargarFormasVenta(idProducto);
    else setFormasVenta([]);
  }, [idProducto, formasPrecargadas]);

  // Recarga la tabla cuando algo externo (ej. el lápiz de U.MEDIDA en AdminCompras.jsx)
  // modificó producto_formas_venta por otro camino — sin tocar el modal interno.
  useEffect(() => {
    if (refrescarSenal === undefined) return;
    if (idProducto) cargarFormasVenta(idProducto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refrescarSenal]);

  const abrirModalNueva = () => {
    setFormaEnEdicion(null);
    setNuevaForma({ id_medida: '', factor: 1, p_compra: '', precio_venta: '' });
    setShowModalForma(true);
  };

  const abrirModalEditar = (fv) => {
    setFormaEnEdicion(fv);
    setNuevaForma({ id_medida: fv.id_medida, factor: fv.factor, p_compra: fv.p_compra ?? '', precio_venta: fv.precio_venta });
    setShowModalForma(true);
  };

  const ejecutarGuardadoForma = async () => {
    try {
      if (formaEnEdicion) {
        const { error } = await supabase.from('producto_formas_venta').update({
          id_medida: Number(nuevaForma.id_medida),
          factor: Number(nuevaForma.factor) || 1,
          p_compra: Number(nuevaForma.p_compra) || 0,
          precio_venta: Number(nuevaForma.precio_venta),
        }).eq('id_forma', formaEnEdicion.id_forma);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('producto_formas_venta').insert({
          id_producto: idProducto,
          id_medida: Number(nuevaForma.id_medida),
          factor: Number(nuevaForma.factor) || 1,
          p_compra: Number(nuevaForma.p_compra) || 0,
          precio_venta: Number(nuevaForma.precio_venta),
          orden: formasVenta.length + 1,
        });
        if (error) throw error;
      }
      setShowModalForma(false);
      setFormaEnEdicion(null);
      onFormaGuardada?.({
        id_medida: Number(nuevaForma.id_medida),
        factor: Number(nuevaForma.factor) || 1,
        p_compra: Number(nuevaForma.p_compra) || 0,
        precio_venta: Number(nuevaForma.precio_venta),
      });
      setNuevaForma({ id_medida: '', factor: 1, p_compra: '', precio_venta: '' });
      cargarFormasVenta(idProducto);
    } catch (err) {
      mostrarAlerta('Error al guardar: ' + err.message, 'error');
    }
  };

  const guardarFormaVenta = () => {
    if (!idProducto) return mostrarAlerta('Selecciona un producto primero.', 'warning');
    if (!nuevaForma.id_medida) return mostrarAlerta('Selecciona una forma de venta.', 'warning');
    if (!nuevaForma.precio_venta || Number(nuevaForma.precio_venta) <= 0) return mostrarAlerta('El precio de venta debe ser mayor a 0.', 'warning');
    mostrarAlerta(
      '¿Seguro que quieres guardar esta forma de venta?',
      'warning',
      ejecutarGuardadoForma,
      'Sí, guardar',
      null,
      'Cancelar'
    );
  };

  const quitarFormaVenta = async (idForma) => {
    mostrarAlerta('¿Quitar esta forma de venta?', 'warning', async () => {
      await supabase.from('producto_formas_venta').update({ activo: false }).eq('id_forma', idForma);
      cargarFormasVenta(idProducto);
    }, 'Sí, quitar', null, 'Cancelar');
  };

  const utilidadModal = Number(nuevaForma.precio_venta || 0) - Number(nuevaForma.p_compra || 0);

  useEffect(() => {
    if (!showModalForma) return undefined;
    const t = window.setTimeout(() => unidadFormaRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [showModalForma]);

  const handleEnterUltimoCampoForma = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    guardarFormaVenta();
  };

  return (
    <div className="formas-venta-section" style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0 }}><UiIcon name="Wallet" size={15} /> Formas de Venta y Precios
        </h4>
        <button
          type="button"
          onClick={abrirModalNueva}
          disabled={!idProducto}
          data-enter-skip="true"
          tabIndex={-1}
          style={{ padding: '0.5rem 0.9rem', background: idProducto ? 'linear-gradient(135deg,#012B63,#0a3d7a)' : '#cbd5e1', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', cursor: idProducto ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
        >
          + Nueva forma de venta
        </button>
      </div>

      {/* Tabla de formas de venta configuradas */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: '#0f172a', color: 'white' }}>
            <th style={{ padding: '0.6rem', textAlign: 'left' }}>U. MEDIDA</th>
            <th style={{ padding: '0.6rem', textAlign: 'center' }}>FACTOR</th>
            <th style={{ padding: '0.6rem', textAlign: 'right' }}>P. COMPRA</th>
            <th style={{ padding: '0.6rem', textAlign: 'right' }}>PRECIO VENTA</th>
            <th style={{ padding: '0.6rem', textAlign: 'right' }}>GANANCIA</th>
            <th style={{ padding: '0.6rem', textAlign: 'center' }}>%</th>
            <th style={{ padding: '0.6rem', textAlign: 'center' }}>ACCIÓN</th>
          </tr>
        </thead>
        <tbody>
          {formasVenta.length === 0 ? (
            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8' }}>{mensajeVacio || 'No hay formas de venta configuradas aún.'}</td></tr>
          ) : (
            formasVenta.map((fv, i) => {
              const ganancia = Number(fv.precio_venta) - Number(fv.p_compra || 0);
              const pctTxt = formatearPorcentajeGanancia(fv.precio_venta, fv.p_compra);
              const costoNuevo = Number(costoActualIngresado) || 0;
              const costoGuardado = Number(fv.p_compra) || 0;
              const debeResaltar = costoNuevo > 0 && costoNuevo > costoGuardado;
              return (
                <tr key={fv.id_forma} style={{ borderBottom: '1px solid #f1f5f9', background: debeResaltar ? '#fef9c3' : (i % 2 === 1 ? '#fafbfc' : 'white') }}>
                  <td style={{ padding: '0.6rem', fontWeight: 700 }}>{fv.unidades_medida?.nombre}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'center' }}>{Number(fv.factor).toFixed(2)}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'right' }}>{formatSolesUnitario(fv.p_compra || 0)}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: 700 }}>{formatSolesUnitario(fv.precio_venta)}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'right', color: ganancia >= 0 ? '#16a34a' : '#dc2626' }}>{ganancia.toFixed(2)}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'center', color: '#0369a1' }}>{pctTxt}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                    <button type="button" onClick={() => abrirModalEditar(fv)} data-enter-skip="true" tabIndex={-1} title="Editar forma de venta" style={{ marginRight: 6, background: 'none', border: 'none', cursor: 'pointer' }}><UiIcon name="Pencil" size={16} /></button>
                    <button type="button" onClick={() => quitarFormaVenta(fv.id_forma)} data-enter-skip="true" tabIndex={-1} title="Quitar forma de venta" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><UiIcon name="Trash2" size={16} /></button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Modal crear/editar forma de venta */}
      {showModalForma && (
        <div
          role="dialog"
          aria-modal="true"
          data-keyboard-trap
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100001 }}
        >
          <div style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', width: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#1e293b' }}>
              {formaEnEdicion ? <><UiIcon name="Pencil" size={15} /> Editar forma de venta</> : '+ Nueva forma de venta'}
            </h3>

            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>UNIDAD DE MEDIDA</label>
              <select
                ref={unidadFormaRef}
                value={nuevaForma.id_medida}
                onChange={e => setNuevaForma(prev => ({ ...prev, id_medida: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1.5px solid #e2e8f0', marginTop: 4 }}
              >
                <option value="">-- Selecciona --</option>
                {catalogoUnidades.map(u => (<option key={u.id_medida} value={u.id_medida}>{u.nombre}</option>))}
              </select>
            </div>

            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>FACTOR</label>
              <input
                type="number" min="1" step="0.01"
                value={nuevaForma.factor}
                onChange={e => setNuevaForma(prev => ({ ...prev, factor: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1.5px solid #e2e8f0', marginTop: 4 }}
              />
            </div>

            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>P. COMPRA</label>
              <input
                type="number" min="0" step="any"
                value={nuevaForma.p_compra}
                onChange={e => setNuevaForma(prev => ({ ...prev, p_compra: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1.5px solid #e2e8f0', marginTop: 4 }}
              />
            </div>

            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>PRECIO VENTA</label>
              <input
                ref={precioVentaFormaRef}
                type="number" min="0" step="any"
                value={nuevaForma.precio_venta}
                onChange={e => setNuevaForma(prev => ({ ...prev, precio_venta: e.target.value }))}
                onKeyDown={handleEnterUltimoCampoForma}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1.5px solid #e2e8f0', marginTop: 4 }}
              />
            </div>

            <div style={{ textAlign: 'center', margin: '1rem 0', padding: '0.8rem', background: '#fef2f2', borderRadius: '10px' }}>
              <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Utilidad</p>
              <h2 style={{ margin: '4px 0 0', fontSize: '1.6rem', fontWeight: 800, color: '#dc2626' }}>S/ {utilidadModal.toFixed(2)}</h2>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexDirection: 'row-reverse' }}>
              <button
                type="button"
                data-enter-primary="true"
                onClick={guardarFormaVenta}
                style={{ flex: 1, padding: '0.7rem', background: 'linear-gradient(135deg,#012B63,#0a3d7a)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              >
                {formaEnEdicion ? <><UiIcon name="Save" size={15} /> Modificar</> : '+ Crear'}
              </button>
              <button
                type="button"
                onClick={() => setShowModalForma(false)}
                data-enter-skip="true"
                tabIndex={-1}
                style={{ flex: 1, padding: '0.7rem', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              ><UiIcon name="X" size={15} /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import useBuscadorTeclado from '../../hooks/useBuscadorTeclado';
import SmartDateInput from '../../components/SmartDateInput';
import ProductoFormModal from '../../components/ProductoFormModal';
import ReautenticacionModal from '../../components/ReautenticacionModal';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { obtenerStockDisponible, obtenerSiguienteCorrelativo, guardarNotaInventario } from '../../utils/notasInventarioAjustes';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { formatPrecioUnitario } from '../../utils/precioExacto';
import { leerDraftDeUsuario, escribirDraftDeUsuario, limpiarSessionDraft } from '../../utils/sessionDraft';
import './NotaInventarioForm.css';
import UiIcon from '../../components/UiIcon';

const FORM_INICIAL = {
  cantidad: '', costo_unitario: '', nro_lote: '',
  tiene_vencimiento: true, fecha_vencimiento: '', motivo: '',
};

const notaDraftKey = (tipo) => (tipo === 'INGRESO' ? 'nota_inv_ingreso' : 'nota_inv_salida');

// Pantalla única para "Nota de Ingreso" y "Nota de Salida", parametrizada por `tipo` —
// evita duplicar el buscador de producto, el formulario y el flujo de reautenticación
// entre las dos pestañas. Solo cambian: la etiqueta, si el input manda a
// aplicarIngreso/aplicarSalida (dentro de guardarNotaInventario) y si valida contra el
// stock disponible antes de guardar.
//
// `retiroVencido` (opcional, solo SALIDA): precarga desde Alertas → "Gestionar retiro".
// En ese modo se pasa id_lote_especifico a guardarNotaInventario para descontar el
// lote VENCIDO exacto (no FEFO sobre VIGENTE).
export default function NotaInventarioForm({ tipo, onGuardado, retiroVencido = null, onRetiroConsumido }) {
  const { user } = useAuth();
  const esIngreso = tipo === 'INGRESO';
  const storageKey = notaDraftKey(tipo);
  const vieneDeRetiro = Boolean(retiroVencido?.id_lote && retiroVencido?.id_producto && tipo === 'SALIDA');
  const borradorInicial = vieneDeRetiro ? null : leerDraftDeUsuario(storageKey, user?.id_usuario, null);
  const precargaRetiroAplicada = useRef(false);

  const [busqueda, setBusqueda] = useState(() => borradorInicial?.busqueda || '');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const searchTimerRef = useRef(null);
  const searchInputRef = useRef(null);

  const [productoSeleccionado, setProductoSeleccionado] = useState(() => {
    if (vieneDeRetiro) {
      return {
        id_producto: retiroVencido.id_producto,
        descripcion: retiroVencido.descripcion || `Producto #${retiroVencido.id_producto}`,
      };
    }
    return borradorInicial?.productoSeleccionado || null;
  });
  const [stockActual, setStockActual] = useState(() => (vieneDeRetiro ? Number(retiroVencido.cantidad || 0) : 0));
  const [cargandoStock, setCargandoStock] = useState(false);
  const [correlativoPreview, setCorrelativoPreview] = useState(null);

  // Si hay id → salida dirigida a ese lote (VENCIDO). null = FEFO normal sobre VIGENTE.
  const [loteRetiroId, setLoteRetiroId] = useState(() => (vieneDeRetiro ? retiroVencido.id_lote : null));
  const [sucursalRetiro, setSucursalRetiro] = useState(() => (vieneDeRetiro ? retiroVencido.id_sucursal : null));

  const [form, setForm] = useState(() => {
    if (vieneDeRetiro) {
      return {
        ...FORM_INICIAL,
        cantidad: String(retiroVencido.cantidad || ''),
        nro_lote: retiroVencido.nro_lote || '',
        motivo: 'Producto vencido',
      };
    }
    return { ...FORM_INICIAL, ...(borradorInicial?.form || {}) };
  });
  const [fecha, setFecha] = useState(() => borradorInicial?.fecha || new Date().toISOString().slice(0, 10));
  const [guardando, setGuardando] = useState(false);
  const [mostrarReauth, setMostrarReauth] = useState(false);
  const [mostrarNuevoProducto, setMostrarNuevoProducto] = useState(false);
  const [alertaSistema, setAlertaSistema] = useState(null);

  // Misma firma que AdminProductos/AdminInventario: ProductoFormModal exige
  // accionConfirmar (p. ej. "¿Seguro que quieres guardar?") — el toast local
  // anterior ignoraba el callback y el guardado nunca se disparaba.
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };

  const limpiarModoRetiro = () => {
    setLoteRetiroId(null);
    setSucursalRetiro(null);
    onRetiroConsumido?.();
  };

  // Ingreso y Salida usan claves de sessionStorage distintas — cambiar de pestaña
  // no borra el borrador de la otra. Cada instancia restaura su propio draft al montar.
  useEffect(() => {
    obtenerSiguienteCorrelativo(tipo).then(setCorrelativoPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Precarga completa desde Alertas: enriquece producto (lab/costo) sin pisar cantidad/motivo.
  useEffect(() => {
    if (!vieneDeRetiro || precargaRetiroAplicada.current) return;
    precargaRetiroAplicada.current = true;
    let cancelado = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('productos')
          .select('id_producto, codigo_barras, descripcion, laboratorios(nombre), producto_precios(costo, precio_venta)')
          .eq('id_producto', retiroVencido.id_producto)
          .maybeSingle();
        if (cancelado || !data) return;
        setProductoSeleccionado(data);
        setForm((prev) => ({
          ...prev,
          costo_unitario: formatPrecioUnitario(filaProductoPrecios(data.producto_precios)?.costo || 0),
        }));
      } catch { /* empty */ }
    })();
    return () => { cancelado = true; };
  }, [vieneDeRetiro, retiroVencido]);

  // Stock VIGENTE del producto — se omite en modo retiro de lote vencido (ahí el techo
  // es la cantidad del lote VENCIDO, ya cargada en stockActual).
  useEffect(() => {
    if (loteRetiroId) return undefined;
    if (!productoSeleccionado?.id_producto || !user?.id_sucursal) return undefined;
    let cancelado = false;
    setCargandoStock(true);
    obtenerStockDisponible(productoSeleccionado.id_producto, user.id_sucursal).then((stock) => {
      if (!cancelado) {
        setStockActual(stock);
        setCargandoStock(false);
      }
    });
    return () => { cancelado = true; };
  }, [productoSeleccionado?.id_producto, user?.id_sucursal, loteRetiroId]);

  useEffect(() => {
    if (loteRetiroId) return; // no pisar borrador normal con un retiro puntual
    if (!user?.id_usuario) return;
    escribirDraftDeUsuario(storageKey, user.id_usuario, {
      busqueda,
      productoSeleccionado,
      form,
      fecha,
    });
  }, [storageKey, busqueda, productoSeleccionado, form, fecha, loteRetiroId, user?.id_usuario]);

  const limpiarBorradorNota = () => {
    limpiarSessionDraft(storageKey);
    setProductoSeleccionado(null);
    setForm({ ...FORM_INICIAL });
    setBusqueda('');
    setResultados([]);
    setStockActual(0);
    setFecha(new Date().toISOString().slice(0, 10));
    limpiarModoRetiro();
  };

  const buscarProductos = (valor) => {
    setBusqueda(valor);
    clearTimeout(searchTimerRef.current);
    if (valor.trim().length < 3) {
      setResultados([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setBuscando(true);
      const terminoSeguro = valor.replace(/[,()]/g, " ");
      const { data } = await supabase
        .from('productos')
        .select('id_producto, codigo_barras, descripcion, laboratorios(nombre), producto_precios(costo, precio_venta)')
        .or(`descripcion.ilike.%${terminoSeguro}%,codigo_barras.ilike.%${terminoSeguro}%`)
        .eq('activo', 1)
        .order('descripcion', { ascending: true })
        .limit(20);
      setResultados(data || []);
      setBuscando(false);
    }, 350);
  };

  const seleccionarProducto = async (prod) => {
    setProductoSeleccionado(prod);
    setBusqueda('');
    setResultados([]);
    setForm({ ...FORM_INICIAL, costo_unitario: formatPrecioUnitario(filaProductoPrecios(prod.producto_precios)?.costo || 0) });
    setCargandoStock(true);
    const stock = await obtenerStockDisponible(prod.id_producto, user.id_sucursal);
    setStockActual(stock);
    setCargandoStock(false);
  };

  const { filaResaltada, rowRefs, handleKeyDown } = useBuscadorTeclado(resultados, seleccionarProducto);

  const handleGuardadoProductoNuevo = (productoNuevo) => {
    setMostrarNuevoProducto(false);
    seleccionarProducto({ ...productoNuevo, producto_precios: productoNuevo.producto_precios || [] });
  };

  const cantidadNum = Number(form.cantidad) || 0;
  const nuevoStock = esIngreso ? stockActual + cantidadNum : stockActual - cantidadNum;
  const excedeStock = !esIngreso && cantidadNum > stockActual;

  const validar = () => {
    if (!productoSeleccionado) return 'Selecciona un producto.';
    if (!cantidadNum || cantidadNum <= 0) return 'Ingresa una cantidad válida.';
    if (!esIngreso && excedeStock) return `No hay stock suficiente. Disponible: ${stockActual}.`;
    if (esIngreso && form.tiene_vencimiento && !form.fecha_vencimiento) return 'Ingresa la fecha de vencimiento o marca "No tiene vencimiento".';
    return null;
  };

  const handleClickGuardar = () => {
    const errorValidacion = validar();
    if (errorValidacion) return mostrarAlerta(errorValidacion, 'warning');
    setMostrarReauth(true);
  };

  const confirmarYGuardar = async () => {
    setMostrarReauth(false);
    setGuardando(true);
    const resultado = await guardarNotaInventario({
      tipo,
      fecha,
      id_producto: productoSeleccionado.id_producto,
      id_lote: loteRetiroId || null,
      // Flag de aplicación (no es columna DB): si viene, aplicarSalida descuenta
      // ese lote exacto (VENCIDO) en vez de FEFO sobre VIGENTE.
      id_lote_especifico: loteRetiroId || undefined,
      cantidad: cantidadNum,
      costo_unitario: Number(form.costo_unitario) || 0,
      tiene_vencimiento: esIngreso ? !!form.tiene_vencimiento : false,
      fecha_vencimiento: esIngreso && form.tiene_vencimiento ? form.fecha_vencimiento : null,
      nro_lote: form.nro_lote || null,
      motivo: form.motivo.trim(),
      id_usuario_registro: user.id_usuario,
      id_sucursal: sucursalRetiro || user.id_sucursal,
    });
    setGuardando(false);

    if (!resultado.ok) {
      return mostrarAlerta('Error al guardar: ' + (resultado.error?.message || resultado.error), 'error');
    }
    mostrarAlerta(`Nota de ${esIngreso ? 'Ingreso' : 'Salida'} #${resultado.nota.numero_correlativo} guardada correctamente.`, 'success');
    limpiarBorradorNota();
    obtenerSiguienteCorrelativo(tipo).then(setCorrelativoPreview);
    onGuardado?.();
  };

  const handleCambiarProducto = () => {
    setProductoSeleccionado(null);
    setForm({ ...FORM_INICIAL });
    setStockActual(0);
    limpiarModoRetiro();
  };

  return (
    <div className="nota-inv-container">
      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      <ReautenticacionModal
        visible={mostrarReauth}
        mensaje={`Confirma tu contraseña para registrar esta Nota de ${esIngreso ? 'Ingreso' : 'Salida'}.`}
        onConfirmar={confirmarYGuardar}
        onCancelar={() => setMostrarReauth(false)}
      />

      {mostrarNuevoProducto && (
        <ProductoFormModal
          visible={mostrarNuevoProducto}
          modo="crear"
          productoInicial={null}
          onClose={() => setMostrarNuevoProducto(false)}
          onGuardado={handleGuardadoProductoNuevo}
          mostrarAlerta={mostrarAlerta}
        />
      )}

      <div className="nota-inv-header">
        <h3>{esIngreso ? <><UiIcon name="Download" size={15} /> Nota de Ingreso</> : <><UiIcon name="Upload" size={15} /> Nota de Salida</>}</h3>
        <span className="nota-inv-correlativo">
          N° {esIngreso ? 'Ingreso' : 'Salida'}: <strong>{correlativoPreview != null ? String(correlativoPreview).padStart(4, '0') : '...'}</strong>
        </span>
      </div>

      {loteRetiroId && (
        <div className="nota-inv-alert nota-inv-alert-info" style={{ marginBottom: '1rem' }}>
          Retiro de lote vencido <strong>{form.nro_lote || `#${loteRetiroId}`}</strong>
          {' — '}se descontará este lote exacto (no se usa FEFO sobre stock vigente).
        </div>
      )}

      {!productoSeleccionado ? (
        <div className="nota-inv-buscador">
          <div className="nota-inv-search-row">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Escribe 3+ letras del nombre o código de barras..."
              value={busqueda}
              onChange={e => buscarProductos(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button type="button" className="nota-inv-btn-nuevo" onClick={() => setMostrarNuevoProducto(true)}>
              + Nuevo Producto
            </button>
          </div>
          {buscando && <p className="nota-inv-empty">Buscando...</p>}
          {!buscando && busqueda.trim().length >= 3 && resultados.length === 0 && (
            <p className="nota-inv-empty">No se encontraron productos. Puedes crear uno nuevo.</p>
          )}
          {resultados.length > 0 && (
            <div className="nota-inv-resultados">
              {resultados.map((prod, i) => (
                <div
                  key={prod.id_producto}
                  ref={el => rowRefs.current[i] = el}
                  className={`nota-inv-res-row ${i === filaResaltada ? 'resaltada' : ''}`}
                  onClick={() => seleccionarProducto(prod)}
                >
                  <span className="text-bold">{prod.descripcion}</span>
                  <span className="text-muted">{prod.laboratorios?.nombre || 'Genérico'}</span>
                  <span className="text-muted">Cód: {prod.codigo_barras || '---'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="nota-inv-form" data-keyboard-trap>
          <div className="nota-inv-producto-card">
            <div>
              <strong>{productoSeleccionado.descripcion}</strong>
              <br /><small className="text-muted">{productoSeleccionado.laboratorios?.nombre || 'Genérico'} · Cód: {productoSeleccionado.codigo_barras || '---'}</small>
            </div>
            <button type="button" className="nota-inv-btn-cambiar" data-enter-skip="true" tabIndex={-1} onClick={handleCambiarProducto}>Cambiar producto</button>
          </div>

          <div className="nota-inv-grid">
            <div className="nota-inv-group">
              <label>Fecha</label>
              <SmartDateInput value={fecha} onChange={setFecha} />
            </div>
            <div className="nota-inv-group">
              <label>Cantidad *</label>
              <input type="number" min="0.01" step="0.01" value={form.cantidad} onChange={e => setForm({ ...form, cantidad: e.target.value })} autoFocus />
            </div>
            <div className="nota-inv-group">
              <label>Costo/Precio unitario</label>
              <input type="number" min="0" step="any" value={form.costo_unitario} onChange={e => setForm({ ...form, costo_unitario: e.target.value })} />
            </div>
            <div className="nota-inv-group">
              <label>Lote {esIngreso ? '(opcional)' : ''}</label>
              <input
                type="text"
                value={form.nro_lote}
                onChange={e => setForm({ ...form, nro_lote: e.target.value })}
                placeholder="Ej: L-2026-08"
                readOnly={!!loteRetiroId}
              />
            </div>
            {esIngreso && (
              <div className="nota-inv-group">
                <label>Vencimiento</label>
                <div className="nota-inv-venc-row">
                  <SmartDateInput
                    value={form.fecha_vencimiento}
                    readOnly={!form.tiene_vencimiento}
                    onChange={val => setForm({ ...form, fecha_vencimiento: val })}
                  />
                  <label className="nota-inv-checkbox">
                    <input
                      type="checkbox"
                      checked={!form.tiene_vencimiento}
                      onChange={e => setForm({ ...form, tiene_vencimiento: !e.target.checked, fecha_vencimiento: e.target.checked ? '' : form.fecha_vencimiento })}
                    />
                    No tiene vencimiento
                  </label>
                </div>
              </div>
            )}
            <div className="nota-inv-group nota-inv-span-full">
              <label>Motivo / Observación <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></label>
              <textarea value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} placeholder="Ej: Regalo del proveedor, muestra médica, rotura, consumo interno..." rows={2} />
            </div>
          </div>

          <div className="nota-inv-stock-box">
            <div>
              <span className="nota-inv-stock-label">{loteRetiroId ? 'Cant. en lote vencido' : 'Stock Actual'}</span>
              <span className="nota-inv-stock-num">{cargandoStock ? '...' : stockActual}</span>
            </div>
            <span className="nota-inv-stock-arrow">→</span>
            <div>
              <span className="nota-inv-stock-label">Nuevo Stock</span>
              <span className={`nota-inv-stock-num ${excedeStock ? 'nota-inv-stock-error' : esIngreso ? 'nota-inv-stock-up' : 'nota-inv-stock-down'}`}>
                {cargandoStock ? '...' : nuevoStock}
              </span>
            </div>
            {excedeStock && <span className="nota-inv-stock-warning"><UiIcon name="AlertTriangle" size={15} /> La cantidad excede el stock disponible</span>}
          </div>

          <div className="nota-inv-footer">
            <button type="button" className="nota-inv-btn-cancelar" data-enter-skip="true" tabIndex={-1} onClick={limpiarBorradorNota} disabled={guardando}>
              Cancelar
            </button>
            <button type="button" className={`nota-inv-btn-guardar ${esIngreso ? 'ingreso' : 'salida'}`} data-enter-primary="true" onClick={handleClickGuardar} disabled={guardando || cargandoStock}>
              {guardando ? 'Guardando...' : `Guardar Nota de ${esIngreso ? 'Ingreso' : 'Salida'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

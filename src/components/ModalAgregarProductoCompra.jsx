import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import SmartDateInput from './SmartDateInput';
import TablaFormasVenta from './TablaFormasVenta';
import ProductoFormModal from './ProductoFormModal';
import './ProductoFormModal.css';
import UiIcon from './UiIcon';
import useBuscadorTeclado from '../hooks/useBuscadorTeclado';
import { filaProductoPrecios } from '../utils/productoPrecios';
import { DEBOUNCE_BUSQUEDA_MS, MIN_CHARS_BUSQUEDA_VIVA } from '../utils/buscarProductosCatalogo';
import { buscarProductosCompra } from '../utils/buscarProductosCompra';
import { redondear2 } from '../utils/dinero';
import { parsePrecio, formatSolesUnitario } from '../utils/precioExacto';
import { destinoEscModalAgregarProducto } from '../utils/destinoEscModalAgregarProducto';
import BandejaNotificacionesCompra, { BandejaTamanoControl } from './BandejaNotificacionesCompra';
import {
  bandejaTamanoVecino,
  guardarBandejaTamano,
  leerBandejaTamano,
} from '../utils/bandejaNotifCompraTamano';
import icono from '../assets/icono.png';

const CONF_ITEM_INICIAL = {
  idMedidaSeleccionada: '', factor: 1, cantidad: '',
  pCosto: '', pVenta: 0, igvPct: 18, bonificacion: false,
  fVencimiento: '', nroLote: '',
};

function nombreCortoProducto(desc) {
  const t = String(desc || '').trim();
  return (t.split(/\s+/)[0] || t).slice(0, 16);
}

/**
 * Modal "Agregar producto a la compra" — estado de búsqueda/preview/formulario
 * aislado para que teclear o flechar no re-renderice AdminCompras.
 */
export default function ModalAgregarProductoCompra({
  visible,
  onClose,
  onAgregarLinea,
  onProductoCatalogoActualizado,
  productosEnCarrito = 0,
  totalCompra = 0,
  ultimosItems = [],
  maxProductos,
  compararPrecioVenta = true,
  mostrarAlerta,
  filaOrigen = null,
  filaAReemplazar = null,
  edicion = null,
  initialBusqueda = '',
}) {
  const [busquedaProd, setBusquedaProd] = useState(initialBusqueda || '');
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [busquedaConfirmada, setBusquedaConfirmada] = useState(false);
  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [historialCompras, setHistorialCompras] = useState([]);
  const [formasVentaProducto, setFormasVentaProducto] = useState([]);
  const [confItem, setConfItem] = useState({ ...CONF_ITEM_INICIAL });
  const [camposConError, setCamposConError] = useState({});
  const [showModalEdicionRapida, setShowModalEdicionRapida] = useState(false);
  const [edicionRapida, setEdicionRapida] = useState({ factor: 1, precio_venta: '' });
  const [refrescarFormas, setRefrescarFormas] = useState(0);
  const [showModalProductoForm, setShowModalProductoForm] = useState(false);
  const [modoProductoForm, setModoProductoForm] = useState('nuevo');
  const [listaEnfocada, setListaEnfocada] = useState(false);
  const [bandejaTamano, setBandejaTamano] = useState(leerBandejaTamano);
  const cambiarBandejaTamano = (dir) => {
    setBandejaTamano((prev) => guardarBandejaTamano(bandejaTamanoVecino(prev, dir)));
  };

  const focoCantidadPendienteRef = useRef(false);
  const cantidadInputRef = useRef(null);
  const buscadorModalRef = useRef(null);
  const listaResultadosRef = useRef(null);
  const columnaConfigRef = useRef(null);
  const overlayRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const bandejaRef = useRef(null);
  const previewTimerRef = useRef(null);
  const configSeqRef = useRef(0);
  const fVencimientoRef = useRef('');
  const productoSeleccionadoRef = useRef(null);
  const busquedaDebounceRef = useRef(null);
  const busquedaSeqRef = useRef(0);

  const factorActual = Number(confItem.factor) || 1;
  const cantidadTotalUnidades = Number(confItem.cantidad || 0) * factorActual;
  const costoTotalSinIgv = redondear2(cantidadTotalUnidades * Number(confItem.pCosto || 0));
  const igvInformativo = redondear2(costoTotalSinIgv * (Number(confItem.igvPct || 0) / 100));
  const importeVisible = costoTotalSinIgv;

  const resetFormularioLinea = () => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    configSeqRef.current += 1;
    productoSeleccionadoRef.current = null;
    fVencimientoRef.current = '';
    setProductoSeleccionado(null);
    setBusquedaProd('');
    setResultadosBusqueda([]);
    setBusquedaConfirmada(false);
    setFormasVentaProducto([]);
    setHistorialCompras([]);
    setConfItem({ ...CONF_ITEM_INICIAL });
    setCamposConError({});
  };

  const enfocarBuscadorModal = () => {
    const el = buscadorModalRef.current;
    if (!el) return false;
    el.focus();
    el.select?.();
    return document.activeElement === el;
  };

  const enfocarCampoCantidad = () => {
    window.setTimeout(() => {
      cantidadInputRef.current?.focus();
      cantidadInputRef.current?.select();
    }, 50);
  };

  // Foco síncrono: si se aplaza a setTimeout, Chromium (input number) se
  // queda el caret y parece que Esc no hizo nada.
  const enfocarListaResultados = () => {
    const lista = listaResultadosRef.current;
    if (!lista) return false;
    lista.focus({ preventScroll: true });
    const ok = document.activeElement === lista;
    if (ok) setListaEnfocada(true);
    return ok;
  };

  useEffect(() => {
    if (!visible) return undefined;
    if (edicion) {
      productoSeleccionadoRef.current = edicion.producto;
      setProductoSeleccionado(edicion.producto);
      setFormasVentaProducto(edicion.formas || []);
      setConfItem(edicion.confItem);
      fVencimientoRef.current = edicion.confItem?.fVencimiento || '';
      return undefined;
    }
    enfocarBuscadorModal();
    return undefined;
    // Solo al montar / abrir: el padre desmonta el modal al cerrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;

    const onEscCapture = (e) => {
      if (e.key !== 'Escape') return;
      if (showModalProductoForm || showModalEdicionRapida) return;
      if (document.querySelector('.asm-overlay')) return;

      const overlay = overlayRef.current;
      const target = e.target;
      if (!(target instanceof Node) || !overlay?.contains(target)) return;

      const destino = destinoEscModalAgregarProducto({
        target,
        buscador: buscadorModalRef.current,
        lista: listaResultadosRef.current,
        panel: columnaConfigRef.current,
      });

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (destino === 'cerrar') {
        onCloseRef.current?.();
        return;
      }
      if (destino === 'buscador') {
        enfocarBuscadorModal();
        return;
      }
      enfocarListaResultados();
    };

    document.addEventListener('keydown', onEscCapture, true);
    return () => document.removeEventListener('keydown', onEscCapture, true);
  }, [visible, showModalProductoForm, showModalEdicionRapida]);

  const cargarFormasVentaDelProducto = async (idProducto, { aplicar = true } = {}) => {
    const { data } = await supabase
      .from('producto_formas_venta')
      .select('*, unidades_medida(nombre)')
      .eq('id_producto', idProducto)
      .eq('activo', true)
      .order('orden');
    const formas = data || [];
    if (aplicar) setFormasVentaProducto(formas);
    return formas;
  };

  const seleccionarProductoParaConfig = async (prod) => {
    const seq = ++configSeqRef.current;
    productoSeleccionadoRef.current = prod;
    setProductoSeleccionado(prod);
    setCamposConError({});
    fVencimientoRef.current = '';

    const formas = await cargarFormasVentaDelProducto(prod.id_producto, { aplicar: false });
    if (seq !== configSeqRef.current) return;
    setFormasVentaProducto(formas);

    const pBase = filaProductoPrecios(prod.producto_precios);
    let baseConfItem;
    if (formas.length > 0) {
      const primera = formas[0];
      baseConfItem = {
        ...CONF_ITEM_INICIAL,
        idMedidaSeleccionada: primera.id_medida,
        factor: Number(primera.factor) || 1,
        pVenta: Number(primera.precio_venta || pBase?.precio_venta || 0),
      };
    } else {
      baseConfItem = {
        ...CONF_ITEM_INICIAL,
        pVenta: Number(pBase?.precio_venta || 0),
      };
    }

    if (filaAReemplazar) {
      const next = {
        ...baseConfItem,
        cantidad: filaAReemplazar.cantidadDisplay,
        nroLote: filaAReemplazar.nroLote,
        fVencimiento: filaAReemplazar.fVencimiento,
        bonificacion: filaAReemplazar.bonificacion,
        igvPct: filaAReemplazar.igvPct,
      };
      fVencimientoRef.current = next.fVencimiento || '';
      setConfItem(next);
    } else {
      fVencimientoRef.current = '';
      setConfItem(baseConfItem);
    }

    const { data } = await supabase
      .from('compra_detalle')
      .select('cantidad, costo_unitario, subtotal, compras(fecha_compra, nro_documento, proveedores(razon_social))')
      .eq('id_producto', prod.id_producto)
      .order('id_compra_det', { ascending: false }).limit(3);
    if (seq !== configSeqRef.current) return;
    setHistorialCompras(data || []);
  };

  const ejecutarBusquedaProducto = async (valor = busquedaProd, { autoSeleccionarCodigo = false } = {}) => {
    const q = String(valor || '').trim();
    const seq = ++busquedaSeqRef.current;
    if (q.length < 2) {
      if (seq === busquedaSeqRef.current) {
        setResultadosBusqueda([]);
        setBusquedaConfirmada(true);
      }
      return [];
    }
    const resultados = await buscarProductosCompra(q);
    if (seq !== busquedaSeqRef.current) return resultados;
    setResultadosBusqueda(resultados);
    setBusquedaConfirmada(true);

    if (autoSeleccionarCodigo) {
      const coincidenciaExacta = resultados.find((p) => String(p.codigo_barras) === q);
      if (coincidenciaExacta && /^\d+$/.test(q)) {
        focoCantidadPendienteRef.current = true;
        seleccionarProductoParaConfig(coincidenciaExacta);
      }
    }
    return resultados;
  };

  const handleCambioBusquedaProducto = (valor) => {
    setBusquedaProd(valor);
    if (busquedaDebounceRef.current) {
      clearTimeout(busquedaDebounceRef.current);
      busquedaDebounceRef.current = null;
    }
    const t = String(valor || '').trim();
    if (t.length < MIN_CHARS_BUSQUEDA_VIVA) {
      busquedaSeqRef.current += 1;
      setBusquedaConfirmada(false);
      setResultadosBusqueda([]);
      return;
    }
    busquedaDebounceRef.current = setTimeout(() => {
      busquedaDebounceRef.current = null;
      void ejecutarBusquedaProducto(valor);
    }, DEBOUNCE_BUSQUEDA_MS);
  };

  const onPreviewBusqueda = (prod) => {
    if (!prod) return;
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    if (productoSeleccionadoRef.current?.id_producto === prod.id_producto) return;
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      if (productoSeleccionadoRef.current?.id_producto === prod.id_producto) return;
      void seleccionarProductoParaConfig(prod);
    }, 180);
  };

  const onSeleccionarBusqueda = (prod) => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    focoCantidadPendienteRef.current = true;
    if (productoSeleccionadoRef.current?.id_producto === prod.id_producto) {
      enfocarCampoCantidad();
      return;
    }
    void seleccionarProductoParaConfig(prod);
  };

  const { filaResaltada, setFilaResaltada, rowRefs, handleKeyDown: handleKeyDownLista, recordarIdResaltado } = useBuscadorTeclado(
    resultadosBusqueda,
    onSeleccionarBusqueda,
    { onNavigate: onPreviewBusqueda },
  );

  const handleKeyDownBuscador = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const pending = !!busquedaDebounceRef.current;
      if (busquedaDebounceRef.current) {
        clearTimeout(busquedaDebounceRef.current);
        busquedaDebounceRef.current = null;
      }
      if (pending || resultadosBusqueda.length === 0 || !busquedaConfirmada) {
        void ejecutarBusquedaProducto(busquedaProd, { autoSeleccionarCodigo: true });
        return;
      }
      handleKeyDownLista(e);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (resultadosBusqueda.length === 0) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    handleKeyDownLista(e);
  };

  useEffect(() => () => {
    if (busquedaDebounceRef.current) clearTimeout(busquedaDebounceRef.current);
  }, []);

  useEffect(() => {
    productoSeleccionadoRef.current = productoSeleccionado;
    if (!productoSeleccionado || !focoCantidadPendienteRef.current) return undefined;
    focoCantidadPendienteRef.current = false;
    const t = window.setTimeout(() => {
      cantidadInputRef.current?.focus();
      cantidadInputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(t);
  }, [productoSeleccionado]);

  useEffect(() => () => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
  }, []);

  const handleGuardadoProductoForm = (productoGuardado) => {
    if (modoProductoForm === 'nuevo') {
      setResultadosBusqueda((prev) => [productoGuardado, ...prev]);
      seleccionarProductoParaConfig(productoGuardado);
      return;
    }
    recordarIdResaltado(productoGuardado.id_producto);
    const precioNuevo = Number(filaProductoPrecios(productoGuardado.producto_precios)?.precio_venta);
    setResultadosBusqueda((prev) => prev.map((p) => (
      p.id_producto === productoGuardado.id_producto
        ? { ...productoGuardado, stockTotal: p.stockTotal }
        : p
    )));
    setProductoSeleccionado((prev) => (
      prev && prev.id_producto === productoGuardado.id_producto
        ? { ...productoGuardado, stockTotal: prev.stockTotal }
        : prev
    ));
    setConfItem((prev) => (
      Number(prev.factor) === 1 && Number.isFinite(precioNuevo)
        ? { ...prev, pVenta: precioNuevo }
        : prev
    ));
    setRefrescarFormas((v) => v + 1);
    if (productoGuardado.id_producto) {
      void cargarFormasVentaDelProducto(productoGuardado.id_producto);
    }
    onProductoCatalogoActualizado?.(productoGuardado);
  };

  const handleCambiarMedidaVenta = (idMedidaStr) => {
    if (idMedidaStr === '') {
      setConfItem((prev) => ({ ...prev, idMedidaSeleccionada: '', factor: 1 }));
      return;
    }
    const forma = formasVentaProducto.find((f) => String(f.id_medida) === idMedidaStr);
    if (!forma) return;
    setConfItem((prev) => ({
      ...prev,
      idMedidaSeleccionada: forma.id_medida,
      factor: Number(forma.factor) || 1,
      pCosto: Number(forma.p_compra || 0),
      pVenta: Number(forma.precio_venta || 0),
    }));
  };

  const abrirModalEdicionRapidaForma = () => {
    const formaActual = formasVentaProducto.find((f) => String(f.id_medida) === String(confItem.idMedidaSeleccionada));
    if (!formaActual) return;
    setEdicionRapida({ id_forma: formaActual.id_forma, factor: formaActual.factor, precio_venta: formaActual.precio_venta });
    setShowModalEdicionRapida(true);
  };

  const guardarEdicionRapida = async () => {
    mostrarAlerta('¿Seguro que quieres guardar este cambio de precio?', 'warning', async () => {
      await supabase.from('producto_formas_venta').update({
        factor: Number(edicionRapida.factor) || 1,
        precio_venta: Number(edicionRapida.precio_venta) || 0,
      }).eq('id_forma', edicionRapida.id_forma);
      await cargarFormasVentaDelProducto(productoSeleccionado.id_producto);
      setConfItem((prev) => ({ ...prev, pVenta: Number(edicionRapida.precio_venta) || 0 }));
      setRefrescarFormas((v) => v + 1);
      setShowModalEdicionRapida(false);
      enfocarCampoCantidad();
    }, 'Sí, guardar', null, 'Cancelar');
  };

  const handleAgregarAlCarritoDesdeModal = (fechaIso) => {
    if (!productoSeleccionado) return mostrarAlerta('Selecciona un producto primero.', 'warning');
    if (productosEnCarrito >= maxProductos) {
      return mostrarAlerta(`Alcanzaste el máximo de ${maxProductos} productos por compra. Registra esta compra y crea una nueva para continuar agregando.`, 'warning');
    }

    const fVencimiento = (typeof fechaIso === 'string' && fechaIso)
      ? fechaIso
      : (fVencimientoRef.current || confItem.fVencimiento);
    if (fVencimiento) fVencimientoRef.current = fVencimiento;

    const costoVacio = confItem.pCosto === '' || confItem.pCosto == null;
    const costoNum = parsePrecio(confItem.pCosto);
    const costoCeroSinBonif = !confItem.bonificacion && !costoVacio && costoNum === 0;

    const errores = {};
    if (confItem.cantidad <= 0) errores.cantidad = true;
    if (!confItem.bonificacion && !costoCeroSinBonif && (costoVacio || costoNum < 0)) errores.pCosto = true;
    if (!fVencimiento) errores.fVencimiento = true;
    if (!confItem.pVenta || Number(confItem.pVenta) <= 0) errores.pVenta = true;

    if (Object.keys(errores).length > 0) {
      setCamposConError(errores);
      mostrarAlerta('Completa los campos marcados en rojo antes de continuar.', 'warning');
      return;
    }
    setCamposConError({});

    const agregarLinea = (esBonificacion) => {
      const factor = Number(confItem.factor) || 1;
      const cantidadReal = Number(confItem.cantidad) * factor;
      const costoUnitario = esBonificacion ? 0 : parsePrecio(confItem.pCosto);
      const subtotalItem = esBonificacion ? 0 : redondear2(cantidadReal * costoUnitario);
      const nombreMedida = formasVentaProducto.find((f) => String(f.id_medida) === String(confItem.idMedidaSeleccionada))?.unidades_medida?.nombre || 'UNIDAD';

      const nuevoItem = {
        ui_id: filaOrigen?.ui_id || Date.now(),
        id_producto: productoSeleccionado.id_producto,
        descripcion: productoSeleccionado.descripcion,
        laboratorio: productoSeleccionado.laboratorios?.nombre || '---',
        uMedida: nombreMedida,
        idMedidaSeleccionada: confItem.idMedidaSeleccionada,
        cantidad: cantidadReal,
        cantidadDisplay: Number(confItem.cantidad),
        factor,
        pCosto: costoUnitario,
        pVenta: parsePrecio(confItem.pVenta),
        igvPct: Number(confItem.igvPct) || 0,
        bonificacion: !!esBonificacion,
        fVencimiento,
        nroLote: confItem.nroLote,
        subtotal: subtotalItem,
        codigoProveedor: filaOrigen?.codigoProveedor || null,
        descripcionXml: filaOrigen?.descripcionXml || '',
        origenXml: !!filaOrigen?.origenXml,
        matchXml: filaOrigen?.origenXml ? 'manual' : (filaOrigen?.matchXml || null),
        codigoBarras: productoSeleccionado.codigo_barras || filaOrigen?.codigoBarras || '',
        actualizarNombreXml: !!(filaOrigen?.origenXml && filaOrigen.matchXml !== 'nuevo' && filaOrigen.actualizarNombreXml),
      };

      const agregarYResetear = () => {
        onAgregarLinea(nuevoItem);
        bandejaRef.current?.push({
          nombre: nuevoItem.descripcion,
          cantidad: nuevoItem.cantidadDisplay,
          unidad: nuevoItem.uMedida,
          subtotal: nuevoItem.subtotal,
        });
        resetFormularioLinea();
        enfocarBuscadorModal();
      };

      const precioAnterior = Number(filaProductoPrecios(productoSeleccionado?.producto_precios)?.precio_venta || 0);
      const precioNuevo = Number(confItem.pVenta);

      if (compararPrecioVenta && precioAnterior > 0 && precioNuevo < precioAnterior) {
        mostrarAlerta(
          `El nuevo precio de venta (S/ ${precioNuevo.toFixed(2)}) es menor al precio actual (S/ ${precioAnterior.toFixed(2)}). ¿Deseas continuar de todas formas?`,
          'warning',
          agregarYResetear,
          'Sí, continuar',
          null,
          'Cancelar',
        );
        return;
      }

      agregarYResetear();
    };

    if (costoCeroSinBonif) {
      mostrarAlerta(
        'El costo es S/ 0.00. ¿Es bonificación?',
        'warning',
        () => {
          setConfItem((prev) => ({ ...prev, bonificacion: true, pCosto: 0 }));
          agregarLinea(true);
        },
        'Sí, es bonificación',
        null,
        'Cancelar',
      );
      return;
    }

    agregarLinea(!!confItem.bonificacion);
  };

  if (!visible) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className="modal-overlay-strict overlay-agregar-producto"
        data-bandeja-tamano={bandejaTamano}
        data-keyboard-trap
        role="dialog"
        aria-modal="true"
        style={showModalProductoForm ? { display: 'none' } : undefined}
      >
        <BandejaTamanoControl tamano={bandejaTamano} onTamano={cambiarBandejaTamano} />
        <BandejaNotificacionesCompra ref={bandejaRef} tamano={bandejaTamano} />
        <div className="popup-producto-card popup-producto-card-ancho popup-agregar-completo">
          <div className="popup-header">
            <div className="popup-title-group popup-title-con-logo">
              <img src={icono} alt="" className="popup-agregar-logo" />
              <div>
                <h3>Agregar producto a la compra</h3>
                <p>Busca por nombre, código de barras o laboratorio</p>
              </div>
            </div>
            <button type="button" className="btn-close-popup" data-enter-skip="true" tabIndex={-1} onClick={onClose}><UiIcon name="X" size={16} /></button>
          </div>
          <div className="compra-modal-tira">
            <span className="compra-modal-tira-meta">
              {productosEnCarrito} {productosEnCarrito === 1 ? 'producto' : 'productos'}
              {' · '}
              S/ {Number(totalCompra).toFixed(2)}
            </span>
            {ultimosItems.length > 0 && (
              <span className="compra-modal-tira-items">
                {ultimosItems.map((p) => `${nombreCortoProducto(p.descripcion)} x${p.cantidadDisplay}`).join(' · ')}
              </span>
            )}
          </div>

          <div className="popup-body">
            <div className="agregar-dos-columnas">
              <div className="columna-buscador">
                <div className="popup-search-row">
                  <div className="search-input-wrapper">
                    <span className="search-icon"><UiIcon name="Search" size={20} /></span>
                    <input
                      ref={buscadorModalRef}
                      type="text"
                      placeholder="Escriba 3 letras o escanee el código..."
                      value={busquedaProd}
                      onChange={(e) => handleCambioBusquedaProducto(e.target.value)}
                      onKeyDown={handleKeyDownBuscador}
                      data-enter-skip="true"
                      autoFocus
                    />
                    {busquedaProd && <button type="button" className="btn-clear-search" data-enter-skip="true" tabIndex={-1} onClick={() => { handleCambioBusquedaProducto(''); }}><UiIcon name="X" size={16} /></button>}
                  </div>
                </div>

                <div className="popup-results-table">
                  <div className="res-header res-grid-4">
                    <span>CÓDIGO</span><span>PRODUCTO</span><span>LABORATORIO</span><span>STOCK</span>
                  </div>
                  <div
                    ref={listaResultadosRef}
                    className={`res-scroll res-scroll-alto${listaEnfocada ? ' is-lista-enfocada' : ''}`}
                    role="listbox"
                    tabIndex={0}
                    aria-label="Resultados de medicamentos"
                    onFocus={() => setListaEnfocada(true)}
                    onBlur={() => setListaEnfocada(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        enfocarBuscadorModal();
                        return;
                      }
                      handleKeyDownLista(e);
                    }}
                  >
                    {resultadosBusqueda.map((prod, i) => (
                      <div
                        key={prod.id_producto}
                        ref={(el) => { rowRefs.current[i] = el; }}
                        className={`res-row res-grid-4 ${i === filaResaltada ? 'resaltada' : ''}`}
                        onClick={() => { setFilaResaltada(i); onSeleccionarBusqueda(prod); }}
                      >
                        <span>{prod.codigo_barras || '---'}</span>
                        <span className="text-bold text-dark">{prod.descripcion}</span>
                        <span className="text-muted">{prod.laboratorios?.nombre || '---'}</span>
                        <span style={{ fontWeight: 700, color: prod.stockTotal > 0 ? '#16a34a' : '#dc2626' }}>{prod.stockTotal ?? 0}</span>
                      </div>
                    ))}
                    {busquedaConfirmada && busquedaProd && resultadosBusqueda.length === 0 && <div className="empty-results">No se hallaron medicamentos en la Base de Datos.</div>}
                    {(!busquedaConfirmada || !busquedaProd) && resultadosBusqueda.length === 0 && <div className="empty-results">Escribe 3 letras para buscar en tu inventario maestro. Enter selecciona el resaltado.</div>}
                  </div>
                </div>

                <div className="pfm-section historial-acotado">
                  <p className="pfm-section-title"><UiIcon name="ClipboardList" size={15} /> Últimas compras de este producto</p>
                  <div className="tabla-acotada">
                    <table className="history-table">
                      <thead>
                        <tr><th>COMPROBANTE</th><th>FECHA</th><th>PROVEEDOR</th><th>CANT.</th><th>P.UNIT</th><th>SUBTOTAL</th></tr>
                      </thead>
                      <tbody>
                        {!productoSeleccionado || historialCompras.length === 0 ? (
                          <tr><td colSpan="6" className="text-center text-muted">No hay compras previas registradas.</td></tr>
                        ) : (
                          historialCompras.map((h, i) => (
                            <tr key={i}>
                              <td>{h.compras?.nro_documento || '---'}</td>
                              <td>{h.compras?.fecha_compra ? new Date(h.compras.fecha_compra).toLocaleDateString() : '---'}</td>
                              <td>{h.compras?.proveedores?.razon_social || '---'}</td>
                              <td>{h.cantidad} und</td>
                              <td>S/ {Number(h.costo_unitario).toFixed(4)}</td>
                              <td className="font-bold">S/ {Number(h.subtotal).toFixed(2)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="pfm-section formas-acotado">
                  <TablaFormasVenta
                    idProducto={productoSeleccionado?.id_producto || null}
                    formasPrecargadas={productoSeleccionado ? formasVentaProducto : null}
                    mostrarAlerta={mostrarAlerta}
                    costoActualIngresado={confItem.pCosto}
                    refrescarSenal={refrescarFormas}
                    mensajeVacio={productoSeleccionado ? undefined : 'Selecciona un producto para ver sus formas de venta'}
                    onFormaGuardada={(forma) => {
                      if (String(forma.id_medida) === String(confItem.idMedidaSeleccionada)) {
                        setConfItem((prev) => ({ ...prev, pVenta: Number(forma.precio_venta) || 0 }));
                      }
                      enfocarCampoCantidad();
                    }}
                  />
                </div>
              </div>

              <div className="columna-config" ref={columnaConfigRef}>
                <div className="modal-prod-acciones">
                  <button
                    type="button"
                    data-enter-skip="true"
                    tabIndex={-1}
                    disabled={!productoSeleccionado}
                    onClick={() => { setModoProductoForm('editar'); setShowModalProductoForm(true); }}
                    className="btn-modal-prod"
                  ><UiIcon name="Pencil" size={15} /> Modificar Producto
                  </button>
                  <button
                    type="button"
                    data-enter-skip="true"
                    tabIndex={-1}
                    onClick={() => { setModoProductoForm('nuevo'); setShowModalProductoForm(true); }}
                    className="btn-modal-prod"
                  >
                    + Nuevo Producto
                  </button>
                </div>
                <div className={`popup-config-area sidebar-config-area pfm-section${productoSeleccionado ? '' : ' sidebar-config-vacio'}`}>
                  <h4 className="config-label">
                    <UiIcon name="Settings" size={15} /> {productoSeleccionado?.descripcion || 'Selecciona un producto'}
                  </h4>

                  <div className="conf-detalle">
                    <div className="conf-item">
                      <label>CANTIDAD *</label>
                      <input
                        ref={cantidadInputRef}
                        type="number" min="1"
                        disabled={!productoSeleccionado}
                        value={confItem.cantidad || ''}
                        onChange={(e) => { setConfItem((prev) => ({ ...prev, cantidad: e.target.value === '' ? '' : Math.max(1, Number(e.target.value)) })); setCamposConError((prev) => ({ ...prev, cantidad: false })); }}
                        style={camposConError.cantidad ? { borderColor: '#ef4444', background: '#fef2f2' } : {}}
                      />
                    </div>

                    <div className="conf-item">
                      <label>U. MEDIDA</label>
                      <div className="conf-medida-wrap">
                        <select
                          value={confItem.idMedidaSeleccionada}
                          disabled={!productoSeleccionado}
                          onChange={(e) => handleCambiarMedidaVenta(e.target.value)}
                        >
                          {formasVentaProducto.length === 0 && <option value="">UNIDAD (x1.00)</option>}
                          {formasVentaProducto.map((f) => (
                            <option key={f.id_forma} value={f.id_medida}>{f.unidades_medida?.nombre || 'UNIDAD'} (x{Number(f.factor).toFixed(2)})</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => abrirModalEdicionRapidaForma()}
                          title="Editar precio de esta forma de venta"
                          data-enter-skip="true"
                          tabIndex={-1}
                          disabled={!productoSeleccionado}
                          className="conf-medida-edit"
                        ><UiIcon name="Pencil" size={16} /></button>
                      </div>
                    </div>

                    <div className="conf-item">
                      <label>P. COSTO {!confItem.bonificacion && '*'}</label>
                      <input
                        type="number" step="any" min="0"
                        disabled={!productoSeleccionado || confItem.bonificacion}
                        value={confItem.pCosto === '' ? '' : confItem.pCosto}
                        onChange={(e) => { setConfItem((prev) => ({ ...prev, pCosto: e.target.value })); setCamposConError((prev) => ({ ...prev, pCosto: false })); }}
                        style={camposConError.pCosto ? { borderColor: '#ef4444', background: '#fef2f2' } : {}}
                      />
                    </div>

                    <div className="conf-item">
                      <label>P. VENTA</label>
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        className="input-solo-lectura"
                        title="Se edita en Formas de Venta y Precios (lápiz)"
                        value={!productoSeleccionado ? '' : formatSolesUnitario(confItem.pVenta)}
                      />
                    </div>

                    <div className="conf-item">
                      <label>IGV Nº <span style={{ fontWeight: 400, color: '#94a3b8' }}>(18, 19...)</span></label>
                      <input
                        type="number" min="0" step="0.01"
                        disabled={!productoSeleccionado}
                        value={confItem.igvPct}
                        data-enter-skip="true"
                        onChange={(e) => setConfItem((prev) => ({ ...prev, igvPct: e.target.value === '' ? '' : Number(e.target.value) }))}
                      />
                    </div>

                    <div className="conf-item">
                      <label>IGV MONTO</label>
                      <input type="text" readOnly className="input-solo-lectura" value={`S/ ${igvInformativo.toFixed(2)}`} />
                    </div>

                    <div className="conf-item">
                      <label>COSTO TOTAL</label>
                      <input type="text" readOnly className="input-solo-lectura input-resaltado-total" value={`S/ ${costoTotalSinIgv.toFixed(2)}`} />
                    </div>

                    <div className="conf-item">
                      <label>IMPORTE</label>
                      <input type="text" readOnly className="input-solo-lectura input-resaltado-total" value={`S/ ${importeVisible.toFixed(2)}`} />
                    </div>

                    <div className="conf-item conf-group-start">
                      <label>N° LOTE</label>
                      <input type="text" placeholder="Ej: 26598" disabled={!productoSeleccionado} value={confItem.nroLote ?? ''} onChange={(e) => setConfItem((prev) => ({ ...prev, nroLote: e.target.value }))} />
                    </div>

                    <div className="conf-item">
                      <label>F. VENCIMIENTO *</label>
                      <SmartDateInput
                        value={confItem.fVencimiento}
                        onChange={(val) => { fVencimientoRef.current = val; setConfItem((prev) => ({ ...prev, fVencimiento: val })); setCamposConError((prev) => ({ ...prev, fVencimiento: false })); }}
                        required
                        readOnly={!productoSeleccionado}
                        hasError={camposConError.fVencimiento}
                        esFechaVencimiento
                        onEnterAnio={handleAgregarAlCarritoDesdeModal}
                      />
                    </div>

                    <div className="conf-item conf-checkbox-item">
                      <label style={{ textTransform: 'none', fontSize: '0.8rem', color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" data-enter-skip="true" tabIndex={-1} disabled={!productoSeleccionado} checked={confItem.bonificacion} onChange={(e) => setConfItem((prev) => ({ ...prev, bonificacion: e.target.checked }))} />
                        Bonificación (costo S/0.00)
                      </label>
                    </div>

                    <div className="conf-item">
                      <label>TOTAL UND</label>
                      <div className="total-und-grande">{productoSeleccionado ? cantidadTotalUnidades : 0}</div>
                    </div>

                    <button
                      type="button"
                      className="btn-agregar-salir"
                      data-enter-primary="true"
                      disabled={!productoSeleccionado}
                      onClick={handleAgregarAlCarritoDesdeModal}
                    >+ Agregar y seguir</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="popup-footer">
            <button className="btn-popup-cancel" data-enter-skip="true" tabIndex={-1} onClick={onClose}><UiIcon name="X" size={15} /> Cancelar</button>
          </div>
        </div>
      </div>

      {showModalEdicionRapida && (
        <div role="dialog" aria-modal="true" data-keyboard-trap style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#1e293b' }}><UiIcon name="Pencil" size={15} /> Editar precio rápido</h3>
            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>FACTOR</label>
              <input type="number" min="1" step="0.01" value={edicionRapida.factor} onChange={(e) => setEdicionRapida((prev) => ({ ...prev, factor: e.target.value }))} style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1.5px solid #e2e8f0', marginTop: 4 }} />
            </div>
            <div style={{ marginBottom: '1.2rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>PRECIO VENTA</label>
              <input
                type="number" min="0" step="any"
                value={edicionRapida.precio_venta}
                onChange={(e) => setEdicionRapida((prev) => ({ ...prev, precio_venta: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  e.stopPropagation();
                  guardarEdicionRapida();
                }}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1.5px solid #e2e8f0', marginTop: 4 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button type="button" data-enter-primary="true" onClick={guardarEdicionRapida} style={{ flex: 1, padding: '0.6rem', background: '#012B63', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><UiIcon name="Save" size={15} /> Guardar</button>
              <button onClick={() => setShowModalEdicionRapida(false)} data-enter-skip="true" tabIndex={-1} style={{ flex: 1, padding: '0.6rem', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <ProductoFormModal
        visible={showModalProductoForm}
        modo={modoProductoForm}
        productoInicial={modoProductoForm === 'editar' ? productoSeleccionado : null}
        onClose={() => {
          setShowModalProductoForm(false);
          enfocarCampoCantidad();
        }}
        onGuardado={handleGuardadoProductoForm}
        mostrarAlerta={mostrarAlerta}
      />
    </>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import TablaFormasVenta from './TablaFormasVenta';
import SmartDateInput from './SmartDateInput';
import ReautenticacionModal from './ReautenticacionModal';
import { esFechaCalendarioValida, formatearFechaPE } from '../utils/fechas';
import { loteTieneMovimientos, marcarLotesVencidos } from '../utils/lotesVencidos';
import {
  fetchLaboratorios,
  normalizarNombreLab,
  notificarLaboratoriosChanged,
  suscribirLaboratoriosChanged,
} from '../utils/laboratoriosCatalogo';
import SearchableSelect from './SearchableSelect';
import UiIcon from './UiIcon';
import { useAppData } from '../context/AppDataContext';
import { marcarCatalogoOfflineStale } from '../utils/catalogoCache';
import { parsePrecio } from '../utils/precioExacto';
import { guardarProductoCatalogo } from '../utils/guardarProductoCatalogo';

// Modal reutilizable de "Nuevo Producto" / "Editar Producto" — usado tanto en
// AdminInventario.jsx como en AdminCompras.jsx (modal "Agregar producto a la compra").
// Usa estilos 100% inline (como TablaFormasVenta) para no depender del CSS
// de ninguna página en particular y verse igual sin importar desde dónde se abra.

function focusPfmControl(id) {
  const root = document.getElementById(id);
  if (!root) return;
  if (root.matches('input, select, textarea, button')) {
    root.focus();
    return;
  }
  const inner = root.querySelector('.ss-input, .ss-control');
  (inner || root).focus();
}

const FORM_PROD_INICIAL = {
  id_producto: null, codigo_barras: '', descripcion: '', id_familia: '',
  id_laboratorio: '', id_presentacion: '', principio_activo: '',
  fraccion: 0, costo: 0, precio_venta: 0,
  dolencias: '',
  stock_minimo: 0, rotar: false, cod_digemid: '', tipo_item: 'PRODUCTO',
  ubicacion: '', inafecto: false, requiere_receta: false,
};

const esActivoLab = (l) => l.activo === 1 || l.activo === true || String(l.activo) === '1';

// Misma forma que consultan las pantallas que abren este modal (el buscador de
// AdminCompras, sobre todo), para que la fila que se devuelve al guardar sea
// intercambiable con las que ya tienen en su estado.
const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100035, padding: '1rem' },
  card: { background: 'white', padding: '1.5rem 2rem', borderRadius: '12px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', maxHeight: '95vh', overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--lf-border)', paddingBottom: '0.75rem' },
  headerH3: { margin: 0, color: 'var(--lf-text)', fontSize: '1.3rem' },
  closeBtn: { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--lf-text-muted)' },
  group: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: '0.7rem', fontWeight: 800, color: '#52525B' },
  input: { padding: '0.6rem 0.7rem', border: '1px solid #E4E4E7', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--lf-text)', outline: 'none', backgroundColor: '#fff' },
  textarea: { padding: '0.6rem 0.7rem', border: '1px solid #E4E4E7', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--lf-text)', outline: 'none', backgroundColor: '#fff', fontFamily: 'inherit', resize: 'vertical', minHeight: '52px' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.3rem' },
  inputDisabled: { padding: '0.6rem 0.7rem', border: '1px solid #E4E4E7', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', backgroundColor: 'var(--lf-info-bg)', color: 'var(--lf-text-muted)', cursor: 'not-allowed' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.25rem', borderTop: '1px solid var(--lf-border)', paddingTop: '1rem' },
  cancelBtn: { background: 'white', color: '#52525B', border: '1px solid #E4E4E7', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  primaryBtn: { background: 'var(--lf-primary-dark)', color: 'white', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' },
};

export default function ProductoFormModal({ visible, modo, productoInicial, onClose, onGuardado, mostrarAlerta }) {
  const { refrescarSeccion } = useAppData();
  const modoEdicion = modo === 'editar';

  const [diccionarios, setDiccionarios] = useState({ familias: [], laboratorios: [], presentaciones: [] });
  const [formProd, setFormProd] = useState({ ...FORM_PROD_INICIAL });
  const setCampo = (campo, valor) => setFormProd((prev) => ({ ...prev, [campo]: valor }));
  const [guardando, setGuardando] = useState(false);

  // Pestañas: Básicos / Adicional / Lotes (solo edición — fechas reales de inventario_lotes).
  const [pfmTab, setPfmTab] = useState('basicos');

  // ── Código de barras automático (solo al crear) — prefijo "99" reconocible para no
  // confundirse con un EAN-13 real, verificado contra la BD antes de aceptarlo ──
  const [generarCodigoAuto, setGenerarCodigoAuto] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);

  // ── Mini-modal "+ Nuevo" laboratorio (alta rápida sin salir del formulario) ──
  const [mostrarNuevoLab, setMostrarNuevoLab] = useState(false);
  const [nombreNuevoLab, setNombreNuevoLab] = useState('');
  const [guardandoNuevoLab, setGuardandoNuevoLab] = useState(false);

  // ── Lotes reales (edición de fecha_vencimiento) ──
  const [lotesProducto, setLotesProducto] = useState([]);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [editandoLoteId, setEditandoLoteId] = useState(null);
  const [fechaEditLote, setFechaEditLote] = useState('');
  const [guardandoFechaLote, setGuardandoFechaLote] = useState(false);
  const [mostrarReauthLote, setMostrarReauthLote] = useState(false);
  const [lotePendienteGuardar, setLotePendienteGuardar] = useState(null);

  // Catálogos: familias/presentaciones al montar; laboratorios también al abrir el
  // modal y cuando Gestionar Laboratorios (u otro alta) notifica cambios — evita lista
  // stale si el modal ya estaba montado con visible=false.
  const cargarCatalogosBase = useCallback(async () => {
    const [resFam, resPres, labs] = await Promise.all([
      supabase.from('familias').select('*'),
      supabase.from('presentaciones').select('*'),
      fetchLaboratorios(),
    ]);
    setDiccionarios({
      familias: (resFam.data || []).filter(f => String(f.activo) === '1' || f.activo === true),
      laboratorios: labs,
      presentaciones: (resPres.data || []).filter(p => String(p.activo) === '1' || p.activo === true),
    });
  }, []);

  const recargarSoloLaboratorios = useCallback(async () => {
    try {
      const labs = await fetchLaboratorios();
      setDiccionarios(prev => ({ ...prev, laboratorios: labs }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    cargarCatalogosBase();
  }, [cargarCatalogosBase]);

  useEffect(() => {
    if (visible) recargarSoloLaboratorios();
  }, [visible, recargarSoloLaboratorios]);

  useEffect(() => suscribirLaboratoriosChanged(recargarSoloLaboratorios), [recargarSoloLaboratorios]);

  const cargarLotesProducto = useCallback(async (idProducto) => {
    if (idProducto == null) {
      setLotesProducto([]);
      return;
    }
    setCargandoLotes(true);
    try {
      const { data, error } = await supabase
        .from('inventario_lotes')
        .select('id_lote, nro_lote, fecha_vencimiento, cantidad_actual, estado, id_sucursal')
        .eq('id_producto', idProducto)
        .order('fecha_vencimiento', { ascending: true });
      if (error) throw error;
      setLotesProducto(data || []);
    } catch (err) {
      console.error('cargarLotesProducto:', err.message);
      setLotesProducto([]);
    } finally {
      setCargandoLotes(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setPfmTab('basicos');
    setEditandoLoteId(null);
    setFechaEditLote('');
    setLotePendienteGuardar(null);
    setMostrarReauthLote(false);
    if (modo === 'editar' && productoInicial?.id_producto != null) {
      cargarLotesProducto(productoInicial.id_producto);
    } else {
      setLotesProducto([]);
    }
  }, [visible, modo, productoInicial?.id_producto, cargarLotesProducto]);

  const iniciarEdicionFechaLote = (lote) => {
    setEditandoLoteId(lote.id_lote);
    setFechaEditLote(lote.fecha_vencimiento ? String(lote.fecha_vencimiento).slice(0, 10) : '');
  };

  const cancelarEdicionFechaLote = () => {
    setEditandoLoteId(null);
    setFechaEditLote('');
    setLotePendienteGuardar(null);
  };

  const solicitarGuardarFechaLote = async (lote) => {
    if (!esFechaCalendarioValida(fechaEditLote)) {
      return mostrarAlerta('Ingresa una fecha de vencimiento válida (dd/mm/aaaa, año entre 2000 y +30).', 'warning');
    }
    const actual = lote.fecha_vencimiento ? String(lote.fecha_vencimiento).slice(0, 10) : '';
    if (actual === fechaEditLote) {
      cancelarEdicionFechaLote();
      return;
    }
    const tieneMov = await loteTieneMovimientos(lote.id_lote, lote.nro_lote);
    const mensaje = tieneMov
      ? `Este lote tiene movimientos registrados. ¿Confirmas corregir la fecha de vencimiento a ${formatearFechaPE(fechaEditLote)}?`
      : `¿Guardar la fecha de vencimiento ${formatearFechaPE(fechaEditLote)} para el lote ${lote.nro_lote || '#' + lote.id_lote}?`;
    mostrarAlerta(
      mensaje,
      'warning',
      () => {
        setLotePendienteGuardar({ id_lote: lote.id_lote, nro_lote: lote.nro_lote, fecha: fechaEditLote });
        setMostrarReauthLote(true);
      },
      'Sí, continuar',
      null,
      'Cancelar'
    );
  };

  const ejecutarGuardarFechaLote = async () => {
    if (!lotePendienteGuardar) return;
    setMostrarReauthLote(false);
    setGuardandoFechaLote(true);
    try {
      const { id_lote, fecha } = lotePendienteGuardar;
      const { error } = await supabase
        .from('inventario_lotes')
        .update({ fecha_vencimiento: fecha })
        .eq('id_lote', id_lote);
      if (error) throw error;
      // Misma regla VIGENTE/VENCIDO que el resto del sistema (incluye revive si tipografía corregida).
      await marcarLotesVencidos();
      mostrarAlerta('Fecha de vencimiento del lote actualizada.', 'success');
      cancelarEdicionFechaLote();
      await cargarLotesProducto(formProd.id_producto);
    } catch (err) {
      mostrarAlerta('Error al actualizar fecha: ' + err.message, 'error');
    } finally {
      setGuardandoFechaLote(false);
      setLotePendienteGuardar(null);
    }
  };

  // Alta rápida de laboratorio desde el propio formulario — mismo criterio de
  // duplicados/confirmación que "Gestionar Laboratorios".
  const ejecutarCrearLaboratorio = async (nombreLimpio) => {
    const nombreGuardar = nombreLimpio.replace(/\s+/g, ' ').trim().toUpperCase();
    setGuardandoNuevoLab(true);
    try {
      const actuales = await fetchLaboratorios();
      if (actuales.some(l => normalizarNombreLab(l.nombre) === normalizarNombreLab(nombreGuardar))) {
        setDiccionarios(prev => ({ ...prev, laboratorios: actuales }));
        return mostrarAlerta('Este laboratorio ya existe.', 'warning');
      }
      const { data: maxData } = await supabase.from('laboratorios').select('id_laboratorio').order('id_laboratorio', { ascending: false }).limit(1).single();
      const nuevoId = (maxData?.id_laboratorio || 0) + 1;
      const { data: nuevoLab, error } = await supabase.from('laboratorios').insert({ id_laboratorio: nuevoId, nombre: nombreGuardar, activo: 1 }).select().single();
      if (error) throw error;
      setDiccionarios(prev => ({ ...prev, laboratorios: [...prev.laboratorios, nuevoLab] }));
      setFormProd(prev => ({ ...prev, id_laboratorio: nuevoLab.id_laboratorio }));
      setMostrarNuevoLab(false);
      setNombreNuevoLab('');
      notificarLaboratoriosChanged();
      mostrarAlerta('Laboratorio agregado y seleccionado.', 'success');
    } catch (error) {
      mostrarAlerta('Error al crear el laboratorio: ' + error.message, 'error');
    } finally {
      setGuardandoNuevoLab(false);
    }
  };

  const guardarNuevoLaboratorio = () => {
    const nombre = nombreNuevoLab.replace(/\s+/g, ' ').trim();
    if (!nombre) return mostrarAlerta('Escribe el nombre del laboratorio.', 'warning');
    if (diccionarios.laboratorios.some(l => normalizarNombreLab(l.nombre) === normalizarNombreLab(nombre))) {
      return mostrarAlerta('Este laboratorio ya existe.', 'warning');
    }
    mostrarAlerta(
      `¿Confirmas crear el laboratorio '${nombre.toUpperCase()}'?`,
      'warning',
      () => { ejecutarCrearLaboratorio(nombre); },
      'Sí, crear',
      () => {},
      'Cancelar'
    );
  };

  // Genera un código de 13 dígitos ("99" + 11 aleatorios) y reintenta si ya existe en
  // productos.codigo_barras — el prefijo "99" no corresponde a ningún país emisor real
  // de EAN-13, así se distingue a simple vista de un código de barras físico escaneado.
  const generarCodigoBarrasAutomatico = async () => {
    setGenerandoCodigo(true);
    try {
      let codigo = '';
      let disponible = false;
      for (let intento = 0; intento < 10 && !disponible; intento++) {
        const sufijo = Math.floor(Math.random() * 1e11).toString().padStart(11, '0');
        codigo = '99' + sufijo;
        const { data } = await supabase.from('productos').select('id_producto').eq('codigo_barras', codigo).maybeSingle();
        disponible = !data;
      }
      if (!disponible) {
        mostrarAlerta('No se pudo generar un código único, intenta de nuevo.', 'error');
        setGenerarCodigoAuto(false);
        return;
      }
      setFormProd(prev => ({ ...prev, codigo_barras: codigo }));
    } catch (error) {
      mostrarAlerta('Error al generar el código: ' + error.message, 'error');
      setGenerarCodigoAuto(false);
    } finally {
      setGenerandoCodigo(false);
    }
  };

  const handleToggleCodigoAuto = (activar) => {
    setGenerarCodigoAuto(activar);
    if (activar) generarCodigoBarrasAutomatico();
    else setFormProd(prev => ({ ...prev, codigo_barras: '' }));
  };

  // Precargar (o limpiar) el formulario cada vez que se abre el modal.
  // La dependencia es el id, no el objeto: AdminCompras mezcla productoSeleccionado
  // al guardar y si el efecto se re-disparara por referencia nueva, pisaría el
  // laboratorio (u otro campo) que el usuario acaba de elegir.
  const idProductoInicial = productoInicial?.id_producto ?? null;
  useEffect(() => {
    if (!visible) return;
    setGenerarCodigoAuto(false);
    setPfmTab('basicos');
    let cancelado = false;
    if (modoEdicion && idProductoInicial != null) {
      (async () => {
        const [{ data: prodRow }, { data: precioRow }] = await Promise.all([
          supabase
            .from('productos')
            .select('*')
            .eq('id_producto', idProductoInicial)
            .maybeSingle(),
          supabase
            .from('producto_precios')
            .select('costo, precio_venta')
            .eq('id_producto', idProductoInicial)
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelado) return;
        const base = prodRow || productoInicial || {};
        setFormProd({
          id_producto: idProductoInicial,
          codigo_barras: base.codigo_barras || '',
          descripcion: base.descripcion || '',
          id_familia: base.id_familia || '',
          id_laboratorio: base.id_laboratorio || '',
          id_presentacion: base.id_presentacion || '',
          principio_activo: base.principio_activo || '',
          fraccion: base.fraccion || 0,
          costo: Number(precioRow?.costo ?? 0),
          precio_venta: Number(precioRow?.precio_venta ?? 0),
          dolencias: base.dolencias || '',
          stock_minimo: base.stock_minimo || 0,
          rotar: base.rotar || false,
          cod_digemid: base.cod_digemid || '',
          tipo_item: base.tipo_item || 'PRODUCTO',
          ubicacion: base.ubicacion || '',
          inafecto: base.inafecto || false,
          requiere_receta: base.requiere_receta || false,
        });
      })();
    } else {
      setFormProd({
        ...FORM_PROD_INICIAL,
        descripcion: productoInicial?.descripcion || '',
        costo: Number(productoInicial?.costo) || 0,
      });
    }
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, modo, idProductoInicial]);

  const ejecutarGuardado = async () => {
    setGuardando(true);
    try {
      const { producto } = await guardarProductoCatalogo(supabase, {
        modo: modoEdicion ? 'editar' : 'nuevo',
        formProd,
      });
      mostrarAlerta(`Producto ${modoEdicion ? 'actualizado' : 'creado'} con éxito.`, 'success');
      try { await refrescarSeccion('productos'); } catch { /* ignore */ }
      marcarCatalogoOfflineStale();
      onGuardado?.(producto);
      onClose();
    } catch (error) {
      if (error?.codigo === 'CODIGO_DUPLICADO') {
        mostrarAlerta(error.message, 'warning');
        return;
      }
      mostrarAlerta('Error en BD: ' + error.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const handleGuardarProducto = (e) => {
    e.preventDefault();
    if (!formProd.descripcion || !parsePrecio(formProd.precio_venta)) return mostrarAlerta('Descripción y Precio son obligatorios.', 'warning');
    if (!formProd.codigo_barras || formProd.codigo_barras.trim() === '') return mostrarAlerta('El código de barras es obligatorio.', 'warning');
    if (!formProd.id_familia) return mostrarAlerta('Selecciona una familia para el producto.', 'warning');
    if (!formProd.id_laboratorio) return mostrarAlerta('Selecciona un laboratorio para el producto.', 'warning');
    mostrarAlerta(
      '¿Seguro que quieres guardar los cambios?',
      'warning',
      ejecutarGuardado,
      'Sí, guardar',
      null,
      'Cancelar'
    );
  };

  if (!visible) return null;

  const idProductoActivo = modoEdicion ? formProd.id_producto : null;

  return (
    <div
      style={s.overlay}
      role="dialog"
      aria-modal="true"
      data-keyboard-trap
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (mostrarNuevoLab) {
          e.preventDefault();
          e.stopPropagation();
          setMostrarNuevoLab(false);
          return;
        }
        if (mostrarReauthLote) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="pfm-card" style={s.card}>
        <div style={s.header}>
          <h3 style={s.headerH3}>{modoEdicion ? <><UiIcon name="Pencil" size={15} /> Editar Producto</> : 'Nuevo Producto'}</h3>
          <button type="button" data-enter-skip="true" tabIndex={-1} onClick={onClose} style={s.closeBtn}><UiIcon name="X" size={16} /></button>
        </div>

        <div className="pfm-tabs">
          <button type="button" data-enter-skip="true" tabIndex={-1} className={`pfm-tab-btn ${pfmTab === 'basicos' ? 'active' : ''}`} onClick={() => setPfmTab('basicos')}><UiIcon name="Receipt" size={15} /> Datos Básicos
          </button>
          <button type="button" data-enter-skip="true" tabIndex={-1} className={`pfm-tab-btn ${pfmTab === 'adicional' ? 'active' : ''}`} onClick={() => setPfmTab('adicional')}><UiIcon name="ClipboardList" size={15} /> Información Adicional
          </button>
          {modoEdicion && (
            <button type="button" data-enter-skip="true" tabIndex={-1} className={`pfm-tab-btn ${pfmTab === 'lotes' ? 'active' : ''}`} onClick={() => setPfmTab('lotes')}><UiIcon name="Package" size={15} /> Stock
            </button>
          )}
        </div>

        <form onSubmit={handleGuardarProducto}>

          <div className="pfm-tab-panels">

          <div className={`pfm-tab-panel ${pfmTab === 'basicos' ? 'is-active' : ''}`}>
            <div className="pfm-section">
              <div className="pfm-grid">
                <div className="pfm-span-full" style={s.group}>
                  <label style={s.label}>Descripción / Nombre comercial *</label>
                  <input type="text" required value={formProd.descripcion} onChange={e => setCampo('descripcion', e.target.value)} placeholder="Ej: PARACETAMOL 500MG" style={s.input} />
                </div>
                <div style={s.group}>
                  <label style={s.label}>Código de Barras</label>
                  <input
                    type="text"
                    value={generandoCodigo ? 'Generando...' : formProd.codigo_barras}
                    onChange={e => setCampo('codigo_barras', e.target.value)}
                    disabled={generarCodigoAuto}
                    style={generarCodigoAuto ? s.inputDisabled : s.input}
                  />
                  {!modoEdicion && (
                    <label style={{ ...s.checkboxRow, cursor: 'pointer' }}>
                      <input type="checkbox" checked={generarCodigoAuto} onChange={e => handleToggleCodigoAuto(e.target.checked)} />
                      <span style={{ fontSize: '0.78rem', color: '#52525B', fontWeight: 600 }}><UiIcon name="RefreshCw" size={15} /> Generar código automático</span>
                    </label>
                  )}
                </div>
                <div style={s.group}>
                  <label style={s.label}>Principio Activo</label>
                  <input type="text" value={formProd.principio_activo} onChange={e => setCampo('principio_activo', e.target.value)} style={s.input} />
                </div>
                <div style={s.group}>
                  <label style={s.label}>Familia / Categoría</label>
                  <select value={formProd.id_familia || ''} onChange={e => setCampo('id_familia', e.target.value)} style={s.input}>
                    <option value="">-- Sin Categoría --</option>
                    {diccionarios.familias.map(f => <option key={f.idfamilia} value={f.idfamilia}>{f.nombre}</option>)}
                  </select>
                </div>
                <div style={s.group}>
                  <label style={s.label}>Laboratorio</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <SearchableSelect
                      className="pfm-lab-select"
                      style={{ flex: 1, minWidth: 0 }}
                      options={diccionarios.laboratorios.filter(
                        (l) => esActivoLab(l) || String(l.id_laboratorio) === String(formProd.id_laboratorio)
                      )}
                      value={formProd.id_laboratorio || ''}
                      onChange={(val) => setCampo('id_laboratorio', val)}
                      getOptionValue={(l) => l.id_laboratorio}
                      getOptionLabel={(l) => `${l.nombre}${!esActivoLab(l) ? ' (inactivo)' : ''}`}
                      getOptionSearchText={(l) => l.nombre}
                      placeholder="Buscar laboratorio..."
                      emptyOptionLabel="-- Seleccionar --"
                      onElegido={() => focusPfmControl('pfm-presentacion')}
                      onEnterWhenClosed={() => {
                        if (formProd.id_laboratorio) focusPfmControl('pfm-presentacion');
                      }}
                    />
                    <button
                      type="button"
                      data-enter-skip="true"
                      tabIndex={-1}
                      onClick={() => { setNombreNuevoLab(''); setMostrarNuevoLab(true); }}
                      style={{
                        padding: '0 0.9rem',
                        border: '1px solid #E4E4E7',
                        borderRadius: '8px',
                        background: 'var(--lf-bg)',
                        color: 'var(--lf-text)',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        height: 42,
                        boxSizing: 'border-box',
                      }}
                    >
                      + Nuevo
                    </button>
                  </div>
                </div>
                <div style={s.group}>
                  <label style={s.label}>Presentación</label>
                  <SearchableSelect
                    id="pfm-presentacion"
                    className="pfm-lab-select"
                    options={diccionarios.presentaciones}
                    value={formProd.id_presentacion || ''}
                    onChange={(val) => setCampo('id_presentacion', val)}
                    getOptionValue={(p) => p.id_presentacion}
                    getOptionLabel={(p) => p.nombre}
                    getOptionSearchText={(p) => p.nombre}
                    placeholder="Buscar presentación..."
                    emptyOptionLabel="-- Seleccionar --"
                    onElegido={() => focusPfmControl('pfm-fraccion')}
                    onEnterWhenClosed={() => {
                      if (formProd.id_presentacion) focusPfmControl('pfm-fraccion');
                    }}
                  />
                </div>
                <div style={s.group}>
                  <label style={s.label}>Fracción (Unds. x caja)</label>
                  <input id="pfm-fraccion" type="number" value={formProd.fraccion} onChange={e => setCampo('fraccion', Number(e.target.value))} style={s.input} />
                </div>
              </div>
            </div>

            <div className="pfm-section">
              <div className="pfm-section-title"><UiIcon name="Wallet" size={15} /> Precios e Inventario Físico</div>
              <div className="pfm-grid">
                <div style={s.group}>
                  <label style={s.label}>Precio Costo Base (S/)</label>
                  <input type="number" step="any" min="0" value={formProd.costo} onChange={e => setCampo('costo', e.target.value)} style={s.input} />
                  <p className="pfm-costo-hint">0 = sin costo / bonificación. No usar 0.01.</p>
                </div>
                <div style={s.group}>
                  <label style={s.label}>Precio Venta Público (S/) *</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={formProd.precio_venta}
                    onChange={e => setCampo('precio_venta', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      e.stopPropagation();
                      handleGuardarProducto(e);
                    }}
                    style={s.input}
                  />
                </div>
                <div className="pfm-span-full" style={{ fontSize: '0.78rem', color: 'var(--lf-text-muted)', fontStyle: 'italic', padding: '0.4rem 0' }}>
                  {modoEdicion
                    ? 'Los ajustes de stock a productos existentes ahora se hacen desde Toma de Inventario → Nota de Ingreso/Salida (con contraseña y motivo registrado).'
                    : 'El producto se crea sin stock. Para agregarlo, usa Compras (si tiene factura) o Toma de Inventario → Nota de Ingreso (si no la tiene).'}
                </div>
              </div>
            </div>
          </div>

          <div className={`pfm-tab-panel ${pfmTab === 'adicional' ? 'is-active' : ''}`}>
            <div className="pfm-section">
              <div className="pfm-grid">
                <div className="pfm-span-full" style={s.group}>
                  <label style={s.label}>Dolencias</label>
                  <textarea value={formProd.dolencias} onChange={e => setCampo('dolencias', e.target.value)} style={s.textarea} placeholder="Ej: Dolor de cabeza, fiebre, gripe..." />
                </div>
                <div style={s.group}>
                  <label style={s.label}>Stock Mínimo</label>
                  <input type="number" value={formProd.stock_minimo} onChange={e => setCampo('stock_minimo', e.target.value === '' ? '' : Number(e.target.value))} style={s.input} />
                </div>
                <div style={s.group}>
                  <label style={s.label}>Cód. DIGEMID</label>
                  <input type="text" value={formProd.cod_digemid} onChange={e => setCampo('cod_digemid', e.target.value)} style={s.input} />
                </div>
                <div style={s.group}>
                  <label style={s.label}>Tipo</label>
                  <select value={formProd.tipo_item} onChange={e => setCampo('tipo_item', e.target.value)} style={s.input}>
                    <option value="PRODUCTO">PRODUCTO</option>
                    <option value="SERVICIO">SERVICIO</option>
                  </select>
                </div>
                <div style={s.group}>
                  <label style={s.label}>Ubicación</label>
                  <input type="text" value={formProd.ubicacion} onChange={e => setCampo('ubicacion', e.target.value)} style={s.input} placeholder="Ej: Estante 3 - Nivel B" />
                </div>
                <div style={s.group}>
                  <label style={s.label}>&nbsp;</label>
                  <label style={{ ...s.checkboxRow, ...s.label }}>
                    <input type="checkbox" checked={formProd.rotar} onChange={e => setCampo('rotar', e.target.checked)} />
                    Rotar
                  </label>
                </div>
                <div style={s.group}>
                  <label style={s.label}>&nbsp;</label>
                  <label style={{ ...s.checkboxRow, ...s.label }}>
                    <input type="checkbox" checked={formProd.inafecto} onChange={e => setCampo('inafecto', e.target.checked)} />
                    Inafecto (exonerado de IGV)
                  </label>
                </div>
                <div style={s.group}>
                  <label style={s.label}>&nbsp;</label>
                  <label style={{ ...s.checkboxRow, ...s.label }}>
                    <input type="checkbox" checked={formProd.requiere_receta} onChange={e => setCampo('requiere_receta', e.target.checked)} />
                    Requiere receta médica
                  </label>
                </div>
              </div>
            </div>
          </div>

          {modoEdicion && (
            <div className={`pfm-tab-panel ${pfmTab === 'lotes' ? 'is-active' : ''}`}>
              <div className="pfm-section">
                <div className="pfm-section-title"><UiIcon name="Package" size={15} /> Stock disponible (fechas reales)</div>
                <p className="pfm-lotes-hint">
                  Corrige tipografías de vencimiento aquí. Esto actualiza el stock usado por FEFO y alertas — no es un campo informativo del producto.
                </p>
                {cargandoLotes ? (
                  <p className="pfm-lotes-empty">Cargando stock…</p>
                ) : lotesProducto.length === 0 ? (
                  <p className="pfm-lotes-empty">Este producto aún no tiene stock. Agrégalo por Compras o Nota de Ingreso.</p>
                ) : (
                  <div className="pfm-lotes-table-wrap">
                    <table className="pfm-lotes-table">
                      <thead>
                        <tr>
                          <th>Nº lote</th>
                          <th>F. vencimiento</th>
                          <th>Cantidad</th>
                          <th>Estado</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotesProducto.map((lote) => {
                          const editando = editandoLoteId === lote.id_lote;
                          return (
                            <tr key={lote.id_lote}>
                              <td>{lote.nro_lote || '—'}</td>
                              <td>
                                {editando ? (
                                  <SmartDateInput
                                    value={fechaEditLote}
                                    onChange={setFechaEditLote}
                                  />
                                ) : (
                                  formatearFechaPE(lote.fecha_vencimiento)
                                )}
                              </td>
                              <td>{Number(lote.cantidad_actual) || 0}</td>
                              <td>
                                <span className={`pfm-lote-estado e-${String(lote.estado || '').toLowerCase()}`}>
                                  {lote.estado || '—'}
                                </span>
                              </td>
                              <td className="pfm-lote-acciones">
                                {editando ? (
                                  <>
                                    <button
                                      type="button"
                                      className="pfm-lote-btn-ok"
                                      disabled={guardandoFechaLote}
                                      onClick={() => solicitarGuardarFechaLote(lote)}
                                    >
                                      Guardar
                                    </button>
                                    <button
                                      type="button"
                                      className="pfm-lote-btn-cancel"
                                      data-enter-skip="true"
                                      tabIndex={-1}
                                      disabled={guardandoFechaLote}
                                      onClick={cancelarEdicionFechaLote}
                                    >
                                      Cancelar
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="pfm-lote-btn-edit"
                                    title="Corregir fecha de vencimiento"
                                    onClick={() => iniciarEdicionFechaLote(lote)}
                                  ><UiIcon name="Pencil" size={15} /> Fecha
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          </div>

          <div style={s.footer}>
            <button type="button" data-enter-skip="true" tabIndex={-1} onClick={onClose} style={s.cancelBtn}>Cancelar</button>
            <button type="submit" data-enter-primary="true" disabled={guardando} style={{ ...s.primaryBtn, opacity: guardando ? 0.6 : 1 }}>{guardando ? 'Guardando...' : 'Guardar Producto'}</button>
          </div>
        </form>

        {idProductoActivo && (
          <TablaFormasVenta idProducto={idProductoActivo} mostrarAlerta={mostrarAlerta} />
        )}
      </div>

      <ReautenticacionModal
        visible={mostrarReauthLote}
        mensaje="Confirma tu contraseña para corregir la fecha de vencimiento del lote (afecta FEFO y alertas)."
        onConfirmar={ejecutarGuardarFechaLote}
        onCancelar={() => { setMostrarReauthLote(false); setLotePendienteGuardar(null); }}
      />

      {mostrarNuevoLab && (
        <div style={{ ...s.overlay, zIndex: 100036 }}>
          <div style={{ ...s.card, maxWidth: '380px', width: '100%' }}>
            <div style={s.header}>
              <h3 style={{ ...s.headerH3, fontSize: '1.1rem' }}><UiIcon name="Factory" size={15} /> Nuevo Laboratorio</h3>
              <button type="button" onClick={() => setMostrarNuevoLab(false)} style={s.closeBtn}><UiIcon name="X" size={16} /></button>
            </div>
            <div style={s.group}>
              <label style={s.label}>Nombre del laboratorio</label>
              <input
                type="text"
                autoFocus
                value={nombreNuevoLab}
                onChange={e => setNombreNuevoLab(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarNuevoLaboratorio(); } }}
                placeholder="Ej: LABORATORIOS PORTUGAL"
                style={s.input}
              />
            </div>
            <div style={{ ...s.footer, marginTop: '1.25rem' }}>
              <button type="button" onClick={() => setMostrarNuevoLab(false)} style={s.cancelBtn}>Cancelar</button>
              <button type="button" disabled={guardandoNuevoLab} onClick={guardarNuevoLaboratorio} style={{ ...s.primaryBtn, opacity: guardandoNuevoLab ? 0.6 : 1 }}>
                {guardandoNuevoLab ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

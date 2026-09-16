import { useCallback, useEffect, useMemo, useState } from 'react';
import UiIcon from '../../components/UiIcon';
import SearchableSelect from '../../components/SearchableSelect';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import {
  listarCodigosProveedor,
  listarCatalogoProductosXml,
  buscarProductoPorCodigoBarras,
  actualizarVinculoCodigoProveedor,
  eliminarVinculoCodigoProveedor,
} from '../../services/productoCodigosProveedor';
import '../AdminImpresora/AdminImpresora.css';
import '../AdminSunat/AdminSunat.css';
import './AdminCodigosProveedor.css';

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function AdminCodigosProveedor() {
  const [filas, setFilas] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [alerta, setAlerta] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [rels, prods] = await Promise.all([
        listarCodigosProveedor(),
        listarCatalogoProductosXml(),
      ]);
      setFilas(rels || []);
      setCatalogo(prods || []);
    } catch (err) {
      setAlerta({
        tipo: 'error',
        mensaje: err.message || 'No se pudieron cargar los códigos de proveedor.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const grupos = useMemo(() => {
    const q = normalizar(filtro);
    const visibles = (filas || []).filter((f) => {
      if (!q) return true;
      const hay = [
        f.codigo_proveedor,
        f.proveedores?.razon_social,
        f.proveedores?.ruc,
        f.productos?.descripcion,
        f.productos?.codigo_barras,
      ].some((v) => normalizar(v).includes(q));
      return hay;
    });
    const map = new Map();
    visibles.forEach((f) => {
      const key = f.id_proveedor;
      if (!map.has(key)) {
        map.set(key, {
          id_proveedor: key,
          nombre: f.proveedores?.razon_social || `Proveedor #${key}`,
          ruc: f.proveedores?.ruc || '',
          items: [],
        });
      }
      map.get(key).items.push(f);
    });
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [filas, filtro]);

  const onCambiarProducto = async (fila, idProducto, prod) => {
    if (!idProducto) return;
    const { ok, error } = await actualizarVinculoCodigoProveedor(fila.id, idProducto);
    if (!ok) {
      setAlerta({ tipo: 'error', mensaje: error?.message || 'No se pudo actualizar el vínculo.' });
      return;
    }
    if (prod && !catalogo.some((p) => String(p.id_producto) === String(prod.id_producto))) {
      setCatalogo((prev) => [prod, ...prev]);
    }
    setFilas((prev) => prev.map((r) => {
      if (r.id !== fila.id) return r;
      const producto = prod || catalogo.find((p) => String(p.id_producto) === String(idProducto));
      return {
        ...r,
        id_producto: Number(idProducto),
        productos: producto
          ? {
            id_producto: producto.id_producto,
            descripcion: producto.descripcion,
            codigo_barras: producto.codigo_barras,
            laboratorios: producto.laboratorios,
          }
          : r.productos,
      };
    }));
    setEditandoId(null);
  };

  const pedirEliminar = (fila) => {
    setAlerta({
      tipo: 'warning',
      mensaje: `¿Eliminar el código ${fila.codigo_proveedor} de ${fila.proveedores?.razon_social || 'este proveedor'}?\nEn la próxima factura XML ese código quedará sin coincidencia automática.`,
      textoConfirmar: 'Sí, eliminar',
      textoCancelar: 'Cancelar',
      accion: async () => {
        const { ok, error } = await eliminarVinculoCodigoProveedor(fila.id);
        if (!ok) {
          setAlerta({ tipo: 'error', mensaje: error?.message || 'No se pudo eliminar.' });
          return;
        }
        setFilas((prev) => prev.filter((r) => r.id !== fila.id));
      },
    });
  };

  return (
    <div className="ai-page acp-page">
      <header className="ai-header">
        <div>
          <p className="ai-eyebrow">CONFIGURACIÓN</p>
          <h1>Códigos de producto por proveedor</h1>
          <p className="ai-muted">
            Relaciones usadas al importar XML de compras. Si un código quedó mal vinculado,
            cámbialo aquí para que las próximas facturas de ese proveedor coincidan bien.
          </p>
        </div>
      </header>

      <div className="ai-card" style={{ marginBottom: '1.25rem' }}>
        <label className="ai-label" htmlFor="acp-filtro">Buscar</label>
        <input
          id="acp-filtro"
          className="asu-input"
          style={{ width: '100%' }}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Proveedor, RUC, código o producto…"
        />
      </div>

      {loading ? (
        <div className="asu-card"><div className="asu-empty">Cargando vínculos…</div></div>
      ) : grupos.length === 0 ? (
        <div className="asu-card">
          <div className="asu-empty">
            {filtro ? 'Ningún vínculo coincide con la búsqueda.' : 'Aún no hay códigos guardados. Se crean al vincular ítems al importar un XML.'}
          </div>
        </div>
      ) : (
        grupos.map((g) => (
          <section key={g.id_proveedor} className="asu-card acp-grupo">
            <header className="acp-grupo-head">
              <div>
                <h2>{g.nombre}</h2>
                {g.ruc ? <p>RUC {g.ruc} · {g.items.length} código{g.items.length === 1 ? '' : 's'}</p> : (
                  <p>{g.items.length} código{g.items.length === 1 ? '' : 's'}</p>
                )}
              </div>
            </header>
            <div className="acp-tabla-wrap">
              <table className="asu-table">
                <thead>
                  <tr>
                    <th>Código proveedor</th>
                    <th>Producto vinculado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((f) => (
                    <tr key={f.id}>
                      <td className="acp-codigo">{f.codigo_proveedor}</td>
                      <td>
                        {editandoId === f.id ? (
                          <SearchableSelect
                            className="acp-select"
                            options={catalogo}
                            value={f.id_producto}
                            onChange={(val, prod) => onCambiarProducto(f, val, prod || null)}
                            getOptionValue={(prod) => prod.id_producto}
                            getOptionLabel={(prod) => prod.descripcion}
                            getOptionSearchText={(prod) => `${prod.descripcion} ${prod.laboratorios?.nombre || ''} ${prod.codigo_barras || ''}`}
                            autoSelectExactBarcode
                            resolveExactBarcode={buscarProductoPorCodigoBarras}
                            placeholder="Nombre o código de barras…"
                          />
                        ) : (
                          <div>
                            <div className="acp-prod">{f.productos?.descripcion || `Producto #${f.id_producto}`}</div>
                            <div className="acp-meta">
                              {[f.productos?.laboratorios?.nombre, f.productos?.codigo_barras].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="acp-acciones">
                        {editandoId === f.id ? (
                          <button type="button" className="ai-btn-secondary" onClick={() => setEditandoId(null)}>
                            Cancelar
                          </button>
                        ) : (
                          <button type="button" className="asu-btn-enviar" onClick={() => setEditandoId(f.id)}>
                            <UiIcon name="Pencil" size={13} /> Cambiar
                          </button>
                        )}
                        <button type="button" className="acp-btn-del" onClick={() => pedirEliminar(f)}>
                          <UiIcon name="Trash2" size={13} /> Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <AlertaSistemaModal alerta={alerta} onClose={() => setAlerta(null)} />
    </div>
  );
}

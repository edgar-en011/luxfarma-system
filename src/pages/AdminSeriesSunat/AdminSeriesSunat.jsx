import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import UiIcon from '../../components/UiIcon';
import '../AdminImpresora/AdminImpresora.css';
import '../AdminSunat/AdminSunat.css';

const TIPOS = [
  { value: 1, label: 'Factura' },
  { value: 2, label: 'Boleta' },
];

const FILA_VACIA = {
  id: null,
  id_sucursal: '',
  tipo_comprobante: 2,
  serie: '',
  ultimo_numero: 0,
  activo: true,
};

export default function AdminSeriesSunat() {
  const [sucursales, setSucursales] = useState([]);
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState(FILA_VACIA);
  const [msg, setMsg] = useState(null);

  const cargar = async () => {
    setLoading(true);
    try {
      const [resSuc, resSeries] = await Promise.all([
        supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo').order('nombre_comercial'),
        supabase.from('series_correlativos').select('*').order('id_sucursal').order('tipo_comprobante'),
      ]);
      if (resSuc.error) throw resSuc.error;
      if (resSeries.error) throw resSeries.error;
      setSucursales(resSuc.data || []);
      setFilas(resSeries.data || []);
    } catch (err) {
      setMsg({ tipo: 'error', texto: err.message || 'No se pudieron cargar las series.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const nombreSucursal = (id) =>
    sucursales.find((s) => s.id_sucursal === id)?.nombre_comercial || `#${id}`;

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.id_sucursal || !String(form.serie).trim()) {
      setMsg({ tipo: 'error', texto: 'Sucursal y serie son obligatorios.' });
      return;
    }
    setGuardando(true);
    setMsg(null);
    try {
      const payload = {
        id_sucursal: Number(form.id_sucursal),
        tipo_comprobante: Number(form.tipo_comprobante),
        serie: String(form.serie).trim().toUpperCase(),
        ultimo_numero: Number(form.ultimo_numero) || 0,
        activo: Boolean(form.activo),
      };
      let error;
      if (form.id) {
        ({ error } = await supabase.from('series_correlativos').update(payload).eq('id', form.id));
      } else {
        ({ error } = await supabase.from('series_correlativos').insert(payload));
      }
      if (error) throw error;
      setForm(FILA_VACIA);
      setMsg({ tipo: 'ok', texto: form.id ? 'Serie actualizada.' : 'Serie registrada.' });
      await cargar();
    } catch (err) {
      setMsg({ tipo: 'error', texto: err.message || 'No se pudo guardar.' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="ai-page" style={{ maxWidth: 980 }}>
      <header className="ai-header">
        <div>
          <p className="ai-eyebrow">CONFIGURACIÓN</p>
          <h1>Series SUNAT por sucursal</h1>
          <p className="ai-muted">
            Cada sucursal usa la serie que Nubefact asignó a su establecimiento SUNAT.
            El correlativo se incrementa solo al emitir. Deja la tabla vacía hasta tener
            la serie real (Julcán u otra sede).
          </p>
        </div>
      </header>

      <form className="ai-card" onSubmit={guardar} style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
          <div>
            <label className="ai-label" htmlFor="ss-sucursal">Sucursal</label>
            <select
              id="ss-sucursal"
              className="ai-select"
              value={form.id_sucursal}
              onChange={(e) => setForm((f) => ({ ...f, id_sucursal: e.target.value }))}
            >
              <option value="">Seleccionar…</option>
              {sucursales.map((s) => (
                <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ai-label" htmlFor="ss-tipo">Tipo</label>
            <select
              id="ss-tipo"
              className="ai-select"
              value={form.tipo_comprobante}
              onChange={(e) => setForm((f) => ({ ...f, tipo_comprobante: Number(e.target.value) }))}
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ai-label" htmlFor="ss-serie">Serie</label>
            <input
              id="ss-serie"
              className="ai-select"
              value={form.serie}
              onChange={(e) => setForm((f) => ({ ...f, serie: e.target.value }))}
              placeholder="Ej. BBB1"
              maxLength={8}
            />
          </div>
          <div>
            <label className="ai-label" htmlFor="ss-num">Último número</label>
            <input
              id="ss-num"
              className="ai-select"
              type="number"
              min={0}
              value={form.ultimo_numero}
              onChange={(e) => setForm((f) => ({ ...f, ultimo_numero: e.target.value }))}
            />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: '0.88rem', fontWeight: 600, color: '#334155' }}>
          <input
            type="checkbox"
            checked={form.activo}
            onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
          />
          Activa (se usará al vender)
        </label>
        <div className="ai-actions">
          {form.id && (
            <button type="button" className="ai-btn-secondary" onClick={() => setForm(FILA_VACIA)}>
              Cancelar edición
            </button>
          )}
          <button type="submit" className="ai-btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : (form.id ? 'Guardar cambios' : 'Agregar serie')}
          </button>
        </div>
        {msg && (
          <div className={`ai-msg ai-msg-${msg.tipo === 'ok' ? 'ok' : 'error'}`} role="status">{msg.texto}</div>
        )}
      </form>

      <div className="asu-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div className="asu-empty">Cargando series…</div>
        ) : filas.length === 0 ? (
          <div className="asu-empty">No hay series cargadas. Agrega la de Julcán cuando Nubefact te la asigne.</div>
        ) : (
          <table className="asu-table">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Tipo</th>
                <th>Serie</th>
                <th>Último número</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{nombreSucursal(f.id_sucursal)}</td>
                  <td>{f.tipo_comprobante === 1 ? 'Factura' : 'Boleta'}</td>
                  <td>{f.serie}</td>
                  <td>{f.ultimo_numero}</td>
                  <td>
                    <span className={`asu-badge ${f.activo ? 'asu-badge-verde' : 'asu-badge-rojo'}`}>
                      {f.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="asu-btn-enviar"
                      onClick={() => setForm({
                        id: f.id,
                        id_sucursal: f.id_sucursal,
                        tipo_comprobante: f.tipo_comprobante,
                        serie: f.serie,
                        ultimo_numero: f.ultimo_numero,
                        activo: f.activo,
                      })}
                    >
                      <UiIcon name="Pencil" size={13} /> Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

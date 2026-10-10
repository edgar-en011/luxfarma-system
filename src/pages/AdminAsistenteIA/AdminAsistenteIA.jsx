import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import UiIcon from '../../components/UiIcon';
import { useAuth } from '../../context/AuthContext';
import {
  cargarDatosAsistenteIA,
  consultarAsistenteIA,
  crearSesionAsistenteIA,
} from '../../services/asistenteIA';
import './AdminAsistenteIA.css';

const PREGUNTAS_SUGERIDAS = [
  '¿Qué productos debería reponer?',
  '¿Qué productos están próximos a vencer?',
  '¿Cuáles tienen poco stock?',
  '¿Cuáles tuvieron mayor movimiento?',
  '¿Qué debería revisar esta semana?',
];

const MENSAJE_INICIAL = {
  id: 'bienvenida',
  rol: 'assistant',
  texto: 'Puedo explicar el resumen y ayudarte a priorizar decisiones. Mis respuestas usan únicamente los datos mostrados en esta página.',
};

function cantidad(valor) {
  return Number(valor || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
}

function ItemResumen({ item, tipo }) {
  let detalle = null;
  if (tipo === 'stockBajo') {
    detalle = `Stock disponible: ${cantidad(item.stockBase)} unidades base · mínimo ${cantidad(item.umbralBase)}`;
  } else if (tipo === 'proximosVencer') {
    detalle = `Lote ${item.numeroLote || 'sin número'} · vence ${item.fechaVencimientoTexto} · ${cantidad(item.stockBase)} unidades base`;
  } else if (tipo === 'bajaRotacion') {
    detalle = `Stock disponible: ${cantidad(item.stockBase)} unidades base · sin ventas en ${item.diasSinVentas} días`;
  } else if (tipo === 'mayorMovimiento') {
    detalle = `${cantidad(item.unidadesVendidas)} unidades base vendidas en 30 días`;
  } else {
    detalle = item.brechaMinimoBase > 0
      ? `Stock: ${cantidad(item.stockBase)} · brecha al mínimo: ${cantidad(item.brechaMinimoBase)} unidades base`
      : `Stock: ${cantidad(item.stockBase)} unidades base · llegó al mínimo configurado`;
  }

  return (
    <li className="aia-summary-item">
      <div className="aia-summary-item-head">
        <strong title={item.nombre}>{item.nombre}</strong>
        {item.prioridad && <span className={`aia-priority ${item.prioridad === 'Crítica' ? 'critical' : ''}`}>{item.prioridad}</span>}
      </div>
      <span>{detalle}</span>
      {item.sucursal && <small>{item.sucursal}</small>}
      {item.equivalencia && <small>Equivalencia: {item.equivalencia}</small>}
    </li>
  );
}

function TarjetaResumen({ icono, titulo, descripcion, total, items, tipo, vacio }) {
  return (
    <article className={`aia-summary-card aia-summary-card--${tipo}`}>
      <header>
        <span className="aia-summary-icon"><UiIcon name={icono} size={19} /></span>
        <div>
          <h3>{titulo}</h3>
          <p>{descripcion}</p>
        </div>
        <strong className="aia-summary-count">{total}</strong>
      </header>
      {items.length === 0 ? (
        <div className="aia-empty"><UiIcon name="CheckCircle2" size={18} /> {vacio}</div>
      ) : (
        <>
          <ul>{items.slice(0, 5).map((item, index) => (
            <ItemResumen key={`${tipo}-${item.idProducto}-${item.idSucursal ?? ''}-${item.idLote ?? index}`} item={item} tipo={tipo} />
          ))}</ul>
          {items.length > 5 && <p className="aia-more">Y {items.length - 5} registro(s) más en el análisis.</p>}
        </>
      )}
    </article>
  );
}

export default function AdminAsistenteIA() {
  const { user } = useAuth();
  const cargaActual = useRef(0);
  const [idSucursal, setIdSucursal] = useState('TODAS');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorDatos, setErrorDatos] = useState('');
  const [sesionIA, setSesionIA] = useState(null);
  const [password, setPassword] = useState('');
  const [autenticando, setAutenticando] = useState(false);
  const [errorSesion, setErrorSesion] = useState('');
  const [mensajes, setMensajes] = useState([MENSAJE_INICIAL]);
  const [pregunta, setPregunta] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [errorChat, setErrorChat] = useState('');

  const cargar = useCallback(async () => {
    const idCarga = ++cargaActual.current;
    setCargando(true);
    setErrorDatos('');
    try {
      const resultado = await cargarDatosAsistenteIA({ idSucursal });
      if (idCarga === cargaActual.current) setDatos(resultado);
    } catch (error) {
      if (idCarga === cargaActual.current) {
        setDatos(null);
        setErrorDatos(error?.message || 'No se pudo cargar el análisis.');
      }
    } finally {
      if (idCarga === cargaActual.current) setCargando(false);
    }
  }, [idSucursal]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!sesionIA?.expires_at) return undefined;
    const restante = Date.parse(sesionIA.expires_at) - Date.now();
    if (restante <= 0) {
      setSesionIA(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setSesionIA(null), restante);
    return () => window.clearTimeout(timer);
  }, [sesionIA]);

  const tarjetas = useMemo(() => {
    const resumen = datos?.resumen;
    if (!resumen) return [];
    return [
      {
        tipo: 'stockBajo', icono: 'TrendingDown', titulo: 'Productos con stock bajo',
        descripcion: 'Según el mínimo configurado', total: resumen.totales.stockBajo,
        items: resumen.stockBajo, vacio: 'No hay productos con stock bajo en este alcance.',
      },
      {
        tipo: 'proximosVencer', icono: 'CalendarDays', titulo: 'Productos próximos a vencer',
        descripcion: `Lotes dentro de ${resumen.metadata.umbralVencimientoDias} días`,
        total: resumen.totales.lotesProximosVencer, items: resumen.proximosVencer,
        vacio: 'No hay lotes próximos a vencer.',
      },
      {
        tipo: 'bajaRotacion', icono: 'Timer', titulo: 'Productos con baja rotación',
        descripcion: 'Con stock y sin ventas en 30 días', total: resumen.totales.bajaRotacion,
        items: resumen.bajaRotacion, vacio: 'No hay productos que cumplan este criterio.',
      },
      {
        tipo: 'mayorMovimiento', icono: 'TrendingUp', titulo: 'Productos con mayor movimiento',
        descripcion: 'Unidades base vendidas en 30 días', total: resumen.totales.conMovimiento,
        items: resumen.mayorMovimiento, vacio: 'No hay ventas registradas en el período.',
      },
      {
        tipo: 'reposicion', icono: 'ShoppingCart', titulo: 'Recomendaciones de reposición',
        descripcion: 'Prioridad informativa, sin compras automáticas',
        total: resumen.totales.recomendacionesReposicion, items: resumen.reposicion,
        vacio: 'No hay reposiciones sugeridas con los datos actuales.',
      },
    ];
  }, [datos]);

  const autenticar = async (event) => {
    event.preventDefault();
    if (!password || autenticando) return;
    setAutenticando(true);
    setErrorSesion('');
    try {
      const sesion = await crearSesionAsistenteIA({
        idUsuario: user?.id_usuario,
        password,
      });
      setSesionIA(sesion);
      setPassword('');
    } catch (error) {
      setErrorSesion(error?.message || 'No se pudo habilitar el asistente.');
    } finally {
      setAutenticando(false);
    }
  };

  const enviarPregunta = async (texto = pregunta) => {
    const limpia = String(texto || '').trim();
    if (!limpia || consultando || !sesionIA?.token || !datos?.snapshotIA) return;

    const mensajeUsuario = { id: `u-${Date.now()}`, rol: 'user', texto: limpia };
    setMensajes((actuales) => [...actuales, mensajeUsuario]);
    setPregunta('');
    setConsultando(true);
    setErrorChat('');
    try {
      const resultado = await consultarAsistenteIA({
        token: sesionIA.token,
        pregunta: limpia,
        snapshot: datos.snapshotIA,
      });
      setMensajes((actuales) => [...actuales, {
        id: `a-${Date.now()}`,
        rol: 'assistant',
        texto: resultado.respuesta,
      }]);
    } catch (error) {
      if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_LIMIT'].includes(error?.code)) {
        setSesionIA(null);
        setErrorSesion('La sesión segura del asistente venció. Confirma tu contraseña nuevamente.');
      }
      setErrorChat(error?.message || 'La IA no pudo responder. El resumen sigue disponible.');
    } finally {
      setConsultando(false);
    }
  };

  return (
    <div className="aia-page">
      <section className="aia-hero">
        <div className="aia-brand">
          <LogoLuxFarma variant="icon" size={48} color="red" />
          <div>
            <p className="aia-eyebrow">Apoyo a decisiones</p>
            <h1>Asistente IA</h1>
            <p>Análisis inteligente para apoyar la gestión de la botica</p>
          </div>
        </div>
        <div className="aia-controls">
          <label htmlFor="aia-sucursal">Sede</label>
          <select id="aia-sucursal" value={idSucursal} onChange={(e) => setIdSucursal(e.target.value)}>
            <option value="TODAS">Todas las sedes</option>
            {(datos?.sucursales || []).map((sucursal) => (
              <option key={sucursal.id_sucursal} value={sucursal.id_sucursal}>{sucursal.nombre_comercial}</option>
            ))}
          </select>
          <button type="button" onClick={cargar} disabled={cargando} title="Actualizar análisis">
            <UiIcon name="RefreshCw" size={17} className={cargando ? 'aia-spin' : ''} />
            Actualizar
          </button>
        </div>
      </section>

      <section className="aia-section" aria-labelledby="aia-resumen-title">
        <div className="aia-section-heading">
          <div>
            <span className="aia-section-icon"><UiIcon name="BarChart3" size={18} /></span>
            <h2 id="aia-resumen-title">Resumen inteligente</h2>
          </div>
          {datos?.resumen && (
            <p>{datos.resumen.metadata.alcance} · {datos.resumen.metadata.periodoDesde} al {datos.resumen.metadata.periodoHasta}</p>
          )}
        </div>

        {cargando ? (
          <div className="aia-loading"><LogoLuxFarma variant="icon" size={40} color="red" /><span>Analizando datos reales…</span></div>
        ) : errorDatos ? (
          <div className="aia-data-error">
            <UiIcon name="AlertCircle" size={20} />
            <div><strong>No se pudo generar el resumen.</strong><span>{errorDatos}</span></div>
            <button type="button" onClick={cargar}>Reintentar</button>
          </div>
        ) : (
          <div className="aia-summary-grid">
            {tarjetas.map((tarjeta) => <TarjetaResumen key={tarjeta.tipo} {...tarjeta} />)}
          </div>
        )}
      </section>

      <section className="aia-assistant" aria-labelledby="aia-chat-title">
        <div className="aia-assistant-head">
          <span><UiIcon name="MessageSquare" size={21} /></span>
          <div>
            <h2 id="aia-chat-title">Asistente</h2>
            <p>Consulta el resumen en lenguaje natural. No ejecuta compras ni modifica inventario.</p>
          </div>
          <span className="aia-readonly"><UiIcon name="Shield" size={14} /> Solo lectura</span>
        </div>

        {!sesionIA?.token ? (
          <div className="aia-auth">
            <div className="aia-auth-copy">
              <span><UiIcon name="Lock" size={22} /></span>
              <div>
                <h3>Confirma tu acceso de administrador</h3>
                <p>La sesión de IA dura 15 minutos y se conserva solo en memoria.</p>
              </div>
            </div>
            <form onSubmit={autenticar}>
              <label htmlFor="aia-password">Contraseña actual</label>
              <div>
                <input
                  id="aia-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  placeholder="Ingresa tu contraseña"
                />
                <button type="submit" disabled={!password || autenticando}>
                  {autenticando ? 'Verificando…' : 'Habilitar asistente'}
                </button>
              </div>
              {errorSesion && <p className="aia-inline-error">{errorSesion}</p>}
            </form>
          </div>
        ) : (
          <>
            <div className="aia-suggestions">
              {PREGUNTAS_SUGERIDAS.map((texto) => (
                <button key={texto} type="button" onClick={() => enviarPregunta(texto)} disabled={consultando || !datos?.snapshotIA}>{texto}</button>
              ))}
            </div>
            <div className="aia-messages" aria-live="polite">
              {mensajes.map((mensaje) => (
                <div key={mensaje.id} className={`aia-message aia-message--${mensaje.rol}`}>
                  <span>{mensaje.rol === 'assistant' ? <UiIcon name="Lightbulb" size={17} /> : <UiIcon name="User" size={17} />}</span>
                  <p>{mensaje.texto}</p>
                </div>
              ))}
              {consultando && <div className="aia-message aia-message--assistant"><span><UiIcon name="Loader" size={17} className="aia-spin" /></span><p>Analizando el resumen…</p></div>}
            </div>
            {errorChat && <p className="aia-chat-error"><UiIcon name="AlertCircle" size={16} /> {errorChat}</p>}
            <form className="aia-composer" onSubmit={(event) => { event.preventDefault(); enviarPregunta(); }}>
              <textarea
                value={pregunta}
                onChange={(event) => setPregunta(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder={datos?.snapshotIA ? 'Escribe una pregunta sobre el resumen…' : 'Carga el resumen para poder consultar…'}
                disabled={consultando || !datos?.snapshotIA}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    enviarPregunta();
                  }
                }}
              />
              <button type="submit" disabled={!pregunta.trim() || consultando || !datos?.snapshotIA}>Enviar</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

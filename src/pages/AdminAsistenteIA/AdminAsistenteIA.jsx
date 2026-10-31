import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import UiIcon from '../../components/UiIcon';
import { useAuth } from '../../context/AuthContext';
import {
  cargarDatosAsistenteIA,
  consultarAsistenteIA,
  consultarStockActualAsistenteIA,
  enviarFeedbackAsistenteIA,
  cargarFeedbackAsistenteIA,
} from '../../services/asistenteIA';
import { leerSesionAsistenteIA, limpiarSesionAsistenteIA } from '../../utils/asistenteIASesion';
import { esConsultaStockActual } from '../../utils/stockAsistenteIA';
import { evaluarPreguntaAsistente } from '../../../supabase/functions/_shared/asistenteScope.js';
import './AdminAsistenteIA.css';

const CONSULTA_STOCK_PLANTILLA = '¿Cuál es el stock actual de ';
const MEMORIA_INACTIVA_MS = 10 * 60 * 1000;
const PREGUNTAS_SUGERIDAS = [
  CONSULTA_STOCK_PLANTILLA,
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

function fechaISOlocal(fecha) {
  const ajustada = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60_000);
  return ajustada.toISOString().slice(0, 10);
}

function periodoInformeVentas(pregunta, idSucursal) {
  const texto = pregunta.toLocaleLowerCase('es');
  if (!/\b(venta|ventas|ingreso|ingresos|recaudaci[oó]n|facturaci[oó]n|ganancia|ganancias|utilidad|ticket|tickets)\b/.test(texto)) return null;
  const hoy = new Date();
  let desde = new Date(hoy);
  let hasta = new Date(hoy);
  if (/\b(ayer|d[ií]a anterior)\b/.test(texto)) {
    desde.setDate(desde.getDate() - 1);
    hasta = new Date(desde);
  } else if (/\b(semana pasada|[uú]ltima semana)\b/.test(texto)) {
    const lunesEsta = new Date(hoy);
    lunesEsta.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    hasta = new Date(lunesEsta);
    hasta.setDate(hasta.getDate() - 1);
    desde = new Date(hasta);
    desde.setDate(desde.getDate() - 6);
  } else if (/\b(mes pasado|[uú]ltimo mes)\b/.test(texto)) {
    desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  } else if (/\b(mes|mensual)\b/.test(texto)) {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  } else if (/\b(semana|semanal)\b/.test(texto)) {
    desde.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  } else if (/\b(30 d[ií]as|[uú]ltimos 30)\b/.test(texto)) {
    desde.setDate(desde.getDate() - 29);
  } else if (/\b(7 d[ií]as|[uú]ltimos 7)\b/.test(texto)) {
    desde.setDate(desde.getDate() - 6);
  }
  return { desde: fechaISOlocal(desde), hasta: fechaISOlocal(hasta), id_sucursal: idSucursal === 'TODAS' ? null : Number(idSucursal) };
}

function TextoConNegritas({ texto }) {
  return String(texto || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((parte, indice) => (
    parte.startsWith('**') && parte.endsWith('**')
      ? <strong key={`${parte}-${indice}`}>{parte.slice(2, -2)}</strong>
      : <span key={`${parte}-${indice}`}>{parte}</span>
  ));
}

function RespuestaIA({ texto }) {
  const bloques = [];
  let lista = [];
  const cerrarLista = () => {
    if (lista.length === 0) return;
    bloques.push({ tipo: 'lista', lineas: lista });
    lista = [];
  };

  for (const lineaOriginal of String(texto || '').split(/\r?\n/)) {
    const linea = lineaOriginal.trim();
    const item = linea.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (item) {
      lista.push(item[1]);
    } else {
      cerrarLista();
      if (linea) bloques.push({ tipo: 'parrafo', texto: linea });
    }
  }
  cerrarLista();

  return (
    <div className="aia-response">
      {bloques.map((bloque, indice) => bloque.tipo === 'lista' ? (
        <ul key={`lista-${indice}`}>
          {bloque.lineas.map((linea, itemIndice) => (
            <li key={`${linea}-${itemIndice}`}><TextoConNegritas texto={linea} /></li>
          ))}
        </ul>
      ) : (
        <p key={`parrafo-${indice}`}><TextoConNegritas texto={bloque.texto} /></p>
      ))}
    </div>
  );
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const cargaActual = useRef(0);
  const cajaPreguntaRef = useRef(null);
  const finMensajesRef = useRef(null);
  const memoriaTimerRef = useRef(null);
  const [idSucursal, setIdSucursal] = useState('TODAS');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorDatos, setErrorDatos] = useState('');
  const [sesionIA, setSesionIA] = useState(() => leerSesionAsistenteIA(user?.id_usuario));
  const [errorSesion, setErrorSesion] = useState('');
  const [mensajes, setMensajes] = useState([MENSAJE_INICIAL]);
  const [pregunta, setPregunta] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [errorChat, setErrorChat] = useState('');
  const [feedbackPorRespuesta, setFeedbackPorRespuesta] = useState({});
  const [resumenFeedback, setResumenFeedback] = useState(null);

  useEffect(() => {
    if (!sesionIA?.token) { setResumenFeedback(null); return undefined; }
    let vigente = true;
    cargarFeedbackAsistenteIA(sesionIA.token)
      .then((resumen) => { if (vigente) setResumenFeedback(resumen); })
      .catch(() => { if (vigente) setResumenFeedback(null); });
    return () => { vigente = false; };
  }, [sesionIA?.token]);

  const valorarRespuesta = useCallback(async (mensaje, util) => {
    if (!mensaje?.feedbackId || !sesionIA?.token) return;
    setFeedbackPorRespuesta((actual) => ({ ...actual, [mensaje.feedbackId]: util }));
    try {
      await enviarFeedbackAsistenteIA({ token: sesionIA.token, respuestaId: mensaje.feedbackId, util });
      const siguiente = await cargarFeedbackAsistenteIA(sesionIA.token);
      setResumenFeedback(siguiente);
    } catch (error) {
      setErrorChat(error?.message || 'No se pudo guardar la valoración.');
    }
  }, [sesionIA?.token]);

  const cargar = useCallback(async () => {
    const idCarga = ++cargaActual.current;
    setCargando(true);
    setErrorDatos('');
    if (!sesionIA?.token) {
      setDatos(null);
      setErrorDatos('La sesión del asistente no está activa. Vuelve a iniciar sesión para habilitarla.');
      setCargando(false);
      return;
    }
    try {
      const resultado = await cargarDatosAsistenteIA({ idSucursal, token: sesionIA.token });
      if (idCarga === cargaActual.current) setDatos(resultado);
    } catch (error) {
      if (idCarga === cargaActual.current) {
        setDatos(null);
        setErrorDatos(error?.message || 'No se pudo cargar el análisis.');
        if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_LIMIT'].includes(error?.code)) {
          limpiarSesionAsistenteIA();
          setSesionIA(null);
          setErrorSesion('La sesión segura venció. Vuelve a iniciar sesión para renovarla.');
        }
      }
    } finally {
      if (idCarga === cargaActual.current) setCargando(false);
    }
  }, [idSucursal, sesionIA?.token]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!sesionIA?.expires_at) return undefined;
    const restante = Date.parse(sesionIA.expires_at) - Date.now();
    if (restante <= 0) {
      limpiarSesionAsistenteIA();
      setSesionIA(null);
      setErrorSesion('La sesión segura venció. Vuelve a iniciar sesión para renovarla.');
      return undefined;
    }
    const timer = window.setTimeout(() => {
      limpiarSesionAsistenteIA();
      setSesionIA(null);
      setErrorSesion('La sesión segura venció. Vuelve a iniciar sesión para renovarla.');
    }, restante);
    return () => window.clearTimeout(timer);
  }, [sesionIA]);

  useEffect(() => {
    finMensajesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mensajes, consultando]);

  useEffect(() => () => {
    if (memoriaTimerRef.current) window.clearTimeout(memoriaTimerRef.current);
  }, []);

  const reiniciarEsperaMemoria = useCallback(() => {
    if (memoriaTimerRef.current) window.clearTimeout(memoriaTimerRef.current);
    memoriaTimerRef.current = window.setTimeout(() => {
      setMensajes([{
        ...MENSAJE_INICIAL,
        texto: 'La conversación anterior se cerró después de 10 minutos sin actividad. Puedes iniciar una nueva consulta; tu sesión de administrador continúa activa.',
      }]);
      setErrorChat('');
      memoriaTimerRef.current = null;
    }, MEMORIA_INACTIVA_MS);
  }, []);

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

  const sinDatosOperativos = useMemo(() => {
    const totales = datos?.resumen?.totales;
    if (!totales || Number(totales.productosAnalizados || 0) === 0) return false;
    if (totales.productosConStock != null) return Number(totales.productosConStock || 0) === 0;
    return Number(totales.stockBajo || 0) === 0
      && Number(totales.lotesProximosVencer || 0) === 0
      && Number(totales.bajaRotacion || 0) === 0
      && Number(totales.conMovimiento || 0) === 0;
  }, [datos]);

  const enviarPregunta = async (texto = pregunta) => {
    const limpia = String(texto || '').trim();
    if (!limpia || consultando || !sesionIA?.token || !datos?.snapshotIA) return;
    if (limpia.toLocaleLowerCase('es') === CONSULTA_STOCK_PLANTILLA.trim().toLocaleLowerCase('es')) {
      setErrorChat('Completa la consulta con el nombre o código del producto.');
      cajaPreguntaRef.current?.focus();
      return;
    }

    const mensajeUsuario = { id: `u-${Date.now()}`, rol: 'user', texto: limpia };
    reiniciarEsperaMemoria();
    setMensajes((actuales) => [...actuales, mensajeUsuario]);
    setPregunta('');
    setErrorChat('');
    const consultaStock = esConsultaStockActual(limpia);
    const alcance = consultaStock ? { permitida: true } : evaluarPreguntaAsistente(limpia, datos.snapshotIA);
    if (!alcance.permitida) {
      setMensajes((actuales) => [...actuales, {
        id: `a-${Date.now()}`,
        rol: 'assistant',
        texto: alcance.mensaje,
        feedbackId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }]);
      return;
    }
    setConsultando(true);
    try {
      const textoPeriodo = limpia.toLocaleLowerCase('es');
      const diasConsulta = /\b(hoy|diari[oa]|del d[ií]a|por d[ií]a)\b/.test(textoPeriodo) ? 1
        : /\b(semanal|esta semana|semana pasada|[uú]ltimos 7 d[ií]as)\b/.test(textoPeriodo) ? 7
          : /\b(mensual|este mes|mes pasado|[uú]ltimos 30 d[ií]as)\b/.test(textoPeriodo) ? 30 : null;
      const datosConsulta = diasConsulta
        ? await cargarDatosAsistenteIA({ idSucursal, token: sesionIA.token, dias: diasConsulta })
        : datos;
      const resultado = consultaStock
        ? await consultarStockActualAsistenteIA({
          pregunta: limpia,
          idSucursal,
          sucursales: datos.sucursales,
        })
        : await consultarAsistenteIA({
          token: sesionIA.token,
          pregunta: limpia,
          snapshot: datosConsulta.snapshotIA,
          historial: mensajes.slice(-6).map((mensaje) => ({
            rol: mensaje.rol,
            texto: mensaje.texto,
          })),
          periodoVentas: periodoInformeVentas(limpia, idSucursal),
        });
      setMensajes((actuales) => [...actuales, {
        id: `a-${Date.now()}`,
        rol: 'assistant',
        texto: resultado.respuesta,
        feedbackId: `respuesta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }]);
    } catch (error) {
      if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_LIMIT'].includes(error?.code)) {
        limpiarSesionAsistenteIA();
        setSesionIA(null);
        setErrorSesion('La sesión segura venció. Vuelve a iniciar sesión para renovarla.');
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

        {!cargando && datos?.resumen?.totales?.productosConStock != null && (
          <div className="aia-coverage-grid" aria-label="Cobertura de datos del inventario">
            <div><span>Catálogo analizado</span><strong>{cantidad(datos.resumen.totales.productosAnalizados)}</strong></div>
            <div><span>Con stock disponible</span><strong>{cantidad(datos.resumen.totales.productosConStock)}</strong></div>
            <div><span>Unidades disponibles</span><strong>{cantidad(datos.resumen.totales.unidadesEnStock)}</strong></div>
            <div className={Number(datos.resumen.totales.productosSinStock || 0) > 0 ? 'is-warning' : ''}>
              <span>Sin stock registrado</span><strong>{cantidad(datos.resumen.totales.productosSinStock)}</strong>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="aia-loading"><LogoLuxFarma variant="icon" size={40} color="red" /><span>Analizando datos reales…</span></div>
        ) : errorDatos ? (
          <div className="aia-data-error">
            <UiIcon name="AlertCircle" size={20} />
            <div><strong>No se pudo generar el resumen.</strong><span>{errorDatos}</span></div>
            <button type="button" onClick={cargar}>Reintentar</button>
          </div>
        ) : (
          <>
            {sinDatosOperativos && (
              <div className="aia-data-warning">
                <UiIcon name="AlertTriangle" size={19} />
                <div>
                  <strong>El catálogo existe, pero no hay inventario analizable.</strong>
                  <span>Se detectaron {cantidad(datos.resumen.totales.productosAnalizados)} productos, pero ningún lote o movimiento útil en el alcance seleccionado. La IA no estimará stock faltante: registra o sincroniza los lotes primero.</span>
                </div>
                <button type="button" onClick={() => navigate('/admin-inventario')}>Revisar inventario</button>
              </div>
            )}
            <div className="aia-summary-grid">
              {tarjetas.map((tarjeta) => <TarjetaResumen key={tarjeta.tipo} {...tarjeta} />)}
            </div>
          </>
        )}
      </section>

      <section className="aia-assistant" aria-labelledby="aia-chat-title">
        <div className="aia-assistant-head">
          <span><UiIcon name="MessageSquare" size={21} /></span>
          <div>
            <h2 id="aia-chat-title">Asistente</h2>
            <p>Consulta el resumen en lenguaje natural. No ejecuta compras ni modifica inventario.</p>
          </div>
          <div className="aia-head-badges">
            <span className="aia-live"><UiIcon name="Database" size={14} /> Stock verificado</span>
            <span className="aia-memory"><UiIcon name="Timer" size={14} /> Memoria 10 min</span>
            <span className="aia-readonly"><UiIcon name="Shield" size={14} /> Solo lectura</span>
            {resumenFeedback?.porcentajeUtiles != null && (
              <span className="aia-feedback-kpi"><UiIcon name="CheckCircle2" size={14} /> Útiles: {resumenFeedback.porcentajeUtiles}% · 30 días</span>
            )}
          </div>
        </div>

        {!sesionIA?.token ? (
          <div className="aia-session-warning">
            <div className="aia-session-warning-copy">
              <span><UiIcon name="Lock" size={22} /></span>
              <div>
                <h3>Inicia sesión nuevamente para habilitar el asistente</h3>
                <p>{errorSesion || 'La autorización se crea automáticamente con el acceso de administrador, sin una segunda contraseña.'}</p>
              </div>
            </div>
            <button type="button" onClick={() => { logout(); navigate('/login'); }}>
              Ir al inicio de sesión
            </button>
          </div>
        ) : (
          <>
            <div className="aia-stock-guide">
              <UiIcon name="CheckCircle2" size={17} />
              <p><strong>Consulta exacta de stock:</strong> escribe el nombre o código del producto. Se mostrará por separado lo disponible, lo vencido y el total físico registrado.</p>
            </div>
            <div className="aia-suggestions">
              {PREGUNTAS_SUGERIDAS.map((texto) => (
                <button
                  key={texto}
                  type="button"
                  onClick={() => {
                    if (texto === CONSULTA_STOCK_PLANTILLA) {
                      setPregunta(texto);
                      window.setTimeout(() => cajaPreguntaRef.current?.focus(), 0);
                    } else {
                      enviarPregunta(texto);
                    }
                  }}
                  disabled={consultando || !datos?.snapshotIA}
                >
                  {texto === CONSULTA_STOCK_PLANTILLA ? 'Consultar stock exacto' : texto}
                </button>
              ))}
            </div>
            <div className="aia-messages" aria-live="polite">
              {mensajes.map((mensaje) => (
                <div key={mensaje.id} className={`aia-message aia-message--${mensaje.rol}`}>
                  <span>{mensaje.rol === 'assistant' ? <UiIcon name="Lightbulb" size={17} /> : <UiIcon name="User" size={17} />}</span>
                  <div className="aia-message-content">
                    {mensaje.rol === 'assistant'
                      ? <RespuestaIA texto={mensaje.texto} />
                      : <p>{mensaje.texto}</p>}
                    {mensaje.rol === 'assistant' && mensaje.feedbackId && (
                      <div className="aia-feedback" aria-label="Valorar respuesta">
                        <span>¿Te sirvió?</span>
                        <button type="button" className={feedbackPorRespuesta[mensaje.feedbackId] === true ? 'selected' : ''}
                          aria-label="Respuesta útil" aria-pressed={feedbackPorRespuesta[mensaje.feedbackId] === true}
                          onClick={() => valorarRespuesta(mensaje, true)}><UiIcon name="Check" size={14} /> Sí</button>
                        <button type="button" className={feedbackPorRespuesta[mensaje.feedbackId] === false ? 'selected' : ''}
                          aria-label="Respuesta no útil" aria-pressed={feedbackPorRespuesta[mensaje.feedbackId] === false}
                          onClick={() => valorarRespuesta(mensaje, false)}><UiIcon name="X" size={14} /> No</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {consultando && <div className="aia-message aia-message--assistant"><span><UiIcon name="Loader" size={17} className="aia-spin" /></span><p>Consultando datos verificados…</p></div>}
              <div ref={finMensajesRef} />
            </div>
            {errorChat && <p className="aia-chat-error"><UiIcon name="AlertCircle" size={16} /> {errorChat}</p>}
            <form className="aia-composer" onSubmit={(event) => { event.preventDefault(); enviarPregunta(); }}>
              <textarea
                ref={cajaPreguntaRef}
                value={pregunta}
                onChange={(event) => setPregunta(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder={datos?.snapshotIA ? 'Ej.: ¿Cuál es el stock actual de Paracetamol 500 mg?' : 'Carga el resumen para poder consultar…'}
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

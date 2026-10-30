import { useCallback, useEffect, useMemo, useState } from 'react'
import { isElectronApp, getPrintersApi } from '../../utils/electronBridge'
import {
  buildTicketHtml,
  buildTicketPruebaPayload,
  printTicketVenta,
  abrirImpresionHtmlTicket,
} from '../../utils/ticketPrint'
import { facturacionElectronica } from '../../config/empresa'
import UiIcon from '../../components/UiIcon'
import './AdminImpresora.css'

export default function AdminImpresora() {
  const enElectron = isElectronApp()
  const api = getPrintersApi()

  const [printers, setPrinters] = useState([])
  const [selected, setSelected] = useState('')
  const [savedName, setSavedName] = useState(null)
  const [configPath, setConfigPath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [printingTicket, setPrintingTicket] = useState(false)
  const [msg, setMsg] = useState(null)
  const [tipoPrueba, setTipoPrueba] = useState(facturacionElectronica ? 'Boleta' : 'Nota de Venta')

  const payloadPrueba = useMemo(() => buildTicketPruebaPayload(tipoPrueba), [tipoPrueba])
  const previewHtml = useMemo(
    () => buildTicketHtml(payloadPrueba, { autoPrint: false }),
    [payloadPrueba],
  )

  const cargar = useCallback(async () => {
    if (!api) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMsg(null)
    try {
      const [listRes, cfgRes] = await Promise.all([
        api.list(),
        api.getConfig(),
      ])
      const names = [...(listRes?.printers || [])].sort((a, b) =>
        a.localeCompare(b, 'es', { sensitivity: 'base' }),
      )
      setPrinters(names)
      const saved = cfgRes?.printerName || null
      setSavedName(saved)
      setConfigPath(cfgRes?.path || null)
      if (saved && names.some((n) => n.toLowerCase() === saved.toLowerCase())) {
        setSelected(saved)
      } else if (saved) {
        setSelected(saved)
        if (!names.includes(saved)) setPrinters([saved, ...names])
      } else if (names.some((n) => n.toLowerCase() === 'pos-80-series')) {
        setSelected(names.find((n) => n.toLowerCase() === 'pos-80-series'))
      } else if (names.length === 1) {
        setSelected(names[0])
      } else {
        setSelected(names[0] || '')
      }
      if (listRes?.error) {
        setMsg({ tipo: 'error', texto: `No se pudo listar impresoras: ${listRes.error}` })
      }
    } catch (err) {
      setMsg({ tipo: 'error', texto: err?.message || String(err) })
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    cargar()
  }, [cargar])

  const handleGuardar = async () => {
    if (!api || !selected) {
      setMsg({ tipo: 'error', texto: 'Selecciona una impresora antes de guardar.' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const res = await api.setConfig({ printerName: selected })
      if (!res?.ok) throw new Error(res?.error || 'No se pudo guardar')
      setSavedName(res.printerName)
      setConfigPath(res.path || configPath)
      setMsg({ tipo: 'ok', texto: `Impresora guardada: ${res.printerName}` })
    } catch (err) {
      setMsg({ tipo: 'error', texto: err?.message || String(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleProbar = async () => {
    if (!api || !selected) {
      setMsg({ tipo: 'error', texto: 'Selecciona una impresora para probar.' })
      return
    }
    setTesting(true)
    setMsg(null)
    try {
      const res = await api.test({ printerName: selected })
      if (!res?.ok) {
        setMsg({
          tipo: 'error',
          texto: `Prueba de conexión falló: ${res?.error || 'error desconocido'}${res?.step ? ` (${res.step})` : ''}`,
        })
      } else {
        setMsg({ tipo: 'ok', texto: `Página de conexión enviada a «${selected}».` })
      }
    } catch (err) {
      setMsg({ tipo: 'error', texto: err?.message || String(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleImprimirTicketPrueba = async () => {
    setPrintingTicket(true)
    setMsg(null)
    try {
      const payload = { ...payloadPrueba, printerName: selected || undefined }
      const result = await printTicketVenta(payload, { silentFallback: true })
      if (result?.ok && result.via === 'thermal') {
        setMsg({ tipo: 'ok', texto: `Ticket de ${tipoPrueba.toLowerCase()} enviado a la impresora.` })
        return
      }
      if (!enElectron) {
        abrirImpresionHtmlTicket(payloadPrueba)
        setMsg({
          tipo: 'ok',
          texto: 'Se abrió la vista de impresión del navegador (esta PC no usa la app de escritorio).',
        })
        return
      }
      setMsg({
        tipo: 'error',
        texto: `No se pudo enviar a la térmica: ${result?.error || 'impresora no conectada'}. La vista previa sigue en pantalla; usa «Imprimir desde el navegador» si quieres papel.`,
      })
    } catch (err) {
      setMsg({ tipo: 'error', texto: err?.message || String(err) })
    } finally {
      setPrintingTicket(false)
    }
  }

  return (
    <div className="ai-page">
      <header className="ai-header">
        <div>
          <p className="ai-eyebrow">CONFIGURACIÓN DE ESTA PC</p>
          <h1>Impresora térmica</h1>
          <p className="ai-muted">
            Elige la impresora de tickets de esta máquina. Cada PC de la farmacia puede
            tener una impresora distinta; la elección se guarda solo aquí (no en la nube).
          </p>
        </div>
        {enElectron && (
          <button type="button" className="ai-btn-secondary" onClick={cargar} disabled={loading}>
            <UiIcon name="RefreshCw" size={15} />
            Actualizar lista
          </button>
        )}
      </header>

      {enElectron ? (
        <div className="ai-card">
          <h2 className="ai-section-title">Impresora de esta PC</h2>
          {loading ? (
            <p className="ai-muted">Detectando impresoras de Windows…</p>
          ) : (
            <>
              <label className="ai-label" htmlFor="ai-printer-select">
                Impresoras instaladas{!loading && printers.length > 0 ? ` (${printers.length})` : ''}
              </label>
              <select
                id="ai-printer-select"
                className="ai-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={printers.length === 0}
              >
                {printers.length === 0 && (
                  <option value="">Sin impresoras</option>
                )}
                {printers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {savedName && name.toLowerCase() === savedName.toLowerCase() ? ' (guardada)' : ''}
                  </option>
                ))}
              </select>

              <div className="ai-meta">
                <div>
                  <span className="ai-meta-label">Guardada en esta PC</span>
                  <strong>{savedName || '— Sin configurar —'}</strong>
                </div>
                {configPath && (
                  <div>
                    <span className="ai-meta-label">Archivo</span>
                    <code className="ai-code">{configPath}</code>
                  </div>
                )}
              </div>

              <div className="ai-actions">
                <button
                  type="button"
                  className="ai-btn-secondary"
                  onClick={handleProbar}
                  disabled={!selected || testing}
                >
                  {testing ? 'Imprimiendo…' : 'Probar impresión'}
                </button>
                <button
                  type="button"
                  className="ai-btn-primary"
                  onClick={handleGuardar}
                  disabled={!selected || saving}
                >
                  <UiIcon name="Save" size={15} />
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>

              <p className="ai-hint">
                {printers.length === 0
                  ? 'Conecta la térmica por USB, instálala en Windows y pulsa «Actualizar lista».'
                  : '«Probar impresión» solo verifica USB/ESC/POS (una página corta). El ticket de boleta/factura con QR y hash está más abajo.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="ai-card">
          <h2 className="ai-section-title">Impresora de esta PC</h2>
          <p className="ai-muted">
            La impresora física se configura en la app de escritorio. Aquí puedes ver
            el ticket de prueba (misma plantilla que una venta real) e imprimirlo desde el navegador.
          </p>
        </div>
      )}

      <div className="ai-card ai-ticket-card">
        <h2 className="ai-section-title">Imprimir ticket de prueba</h2>
        <p className="ai-muted">
          {facturacionElectronica
            ? 'Boleta, factura o nota de venta de ejemplo (cliente ficticio, 3 productos) con la misma plantilla que una venta real.'
            : 'Nota de venta de ejemplo (cliente ficticio, 3 productos) con la misma plantilla que una venta real. Documento interno, sin QR ni textos tributarios.'}
          {' '}No hace falta tener la impresora conectada para ver la vista previa.
        </p>

        <div className="ai-tipo-row" role="group" aria-label="Tipo de comprobante de prueba">
          {['Nota de Venta', 'Boleta', 'Factura'].map((tipo) => (
            <button
              key={tipo}
              type="button"
              className={`ai-tipo-btn ${tipoPrueba === tipo ? 'is-active' : ''}`}
              onClick={() => setTipoPrueba(tipo)}
            >
              {tipo}
            </button>
          ))}
        </div>

        <div className="ai-actions">
          <button
            type="button"
            className="ai-btn-primary"
            onClick={handleImprimirTicketPrueba}
            disabled={printingTicket}
          >
            <UiIcon name="Ticket" size={15} />
            {printingTicket ? 'Enviando…' : 'Imprimir ticket de prueba'}
          </button>
          <button
            type="button"
            className="ai-btn-secondary"
            onClick={() => abrirImpresionHtmlTicket(payloadPrueba)}
          >
            <UiIcon name="Printer" size={15} />
            Imprimir desde el navegador
          </button>
        </div>

        {msg && (
          <div className={`ai-msg ai-msg-${msg.tipo === 'ok' ? 'ok' : 'error'}`} role="status">
            {msg.texto}
          </div>
        )}

        <div className="ai-preview-wrap">
          <p className="ai-meta-label">Vista previa (80 mm)</p>
          <iframe
            className="ai-preview"
            title={`Vista previa ticket ${tipoPrueba}`}
            srcDoc={previewHtml}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}

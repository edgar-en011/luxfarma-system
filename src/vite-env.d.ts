/// <reference types="vite/client" />

interface ElectronAPI {
  isElectron: true
  onFunctionKey: (callback: (key: string) => void) => () => void
  printTicket: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  getPrinterStatus: () => Promise<{
    ok: boolean
    connected?: boolean
    interface?: string
    type?: string
    error?: string
  }>
}

interface Window {
  electronAPI?: ElectronAPI
}

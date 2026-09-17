/**
 * Driver compatible con node-thermal-printer (API tipo paquete `printer`):
 *   getPrinters() / getPrinter(name) / printDirect({ data, printer, type, success, error })
 *
 * En Windows envía RAW (ESC/POS) al spooler vía winspool — sin dependencia nativa npm.
 * Requerido porque `interface: 'printer:Nombre'` SIN driver lanza "No driver set!".
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LOG = '[electron:thermal:driver]'

/** Lista nombres de impresoras instaladas en Windows (winspool vía PowerShell). */
export function listPrinterNamesSync() {
  if (process.platform !== 'win32') {
    console.warn(`${LOG} listPrinterNamesSync: solo Windows`)
    return []
  }
  const stdout = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-Printer | Select-Object -ExpandProperty Name',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    },
  )
  return String(stdout)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function escapePsSingleQuotes(value) {
  return String(value).replace(/'/g, "''")
}

function sendRawToPrinterSync(printerName, buffer) {
  const tmpBin = path.join(os.tmpdir(), `luxfarma-ticket-${Date.now()}-${process.pid}.bin`)
  fs.writeFileSync(tmpBin, buffer)

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class LuxFarmaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new Exception("OpenPrinter failed for '" + printerName + "' (Win32=" + Marshal.GetLastWin32Error() + ")");
    }
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "LuxFarma Ticket";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) {
        throw new Exception("StartDocPrinter failed (Win32=" + Marshal.GetLastWin32Error() + ")");
      }
      try {
        if (!StartPagePrinter(hPrinter)) {
          throw new Exception("StartPagePrinter failed (Win32=" + Marshal.GetLastWin32Error() + ")");
        }
        try {
          IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
            int written;
            if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written)) {
              throw new Exception("WritePrinter failed (Win32=" + Marshal.GetLastWin32Error() + ")");
            }
          } finally {
            Marshal.FreeCoTaskMem(pUnmanaged);
          }
        } finally {
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@
$printer = '${escapePsSingleQuotes(printerName)}'
$path = '${escapePsSingleQuotes(tmpBin)}'
$bytes = [System.IO.File]::ReadAllBytes($path)
[LuxFarmaRawPrinter]::SendBytes($printer, $bytes)
Write-Output 'OK'
`

  try {
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      },
    )
    console.log(`${LOG} winspool RAW OK → "${printerName}" (${buffer.length} bytes)`, String(stdout).trim())
  } finally {
    try {
      fs.unlinkSync(tmpBin)
    } catch {
      /* ignore */
    }
  }
}

/** Driver object esperado por node-thermal-printer lib/interfaces/printer.js */
export const windowsRawDriver = {
  getPrinters() {
    try {
      const names = listPrinterNamesSync()
      console.log(`${LOG} getPrinters →`, names)
      return names.map((name) => ({
        name,
        attributes: ['RAW-ONLY'],
        status: [],
      }))
    } catch (err) {
      console.error(`${LOG} getPrinters FALLÓ:`, err?.message || err)
      return []
    }
  },

  getPrinter(name) {
    try {
      const names = listPrinterNamesSync()
      const found = names.find((n) => n.toLowerCase() === String(name).toLowerCase())
      if (!found) {
        console.warn(`${LOG} getPrinter("${name}") → no encontrada. Disponibles:`, names)
        return null
      }
      console.log(`${LOG} getPrinter("${name}") → OK ("${found}")`)
      return { name: found, attributes: ['RAW-ONLY'], status: [] }
    } catch (err) {
      console.error(`${LOG} getPrinter FALLÓ:`, err?.message || err)
      return null
    }
  },

  printDirect({ data, printer, success, error }) {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
      console.log(`${LOG} printDirect → "${printer}" (${buffer.length} bytes RAW)`)
      sendRawToPrinterSync(printer, buffer)
      success?.(`Printed RAW to ${printer}`)
    } catch (err) {
      console.error(`${LOG} printDirect FALLÓ:`, err?.message || err)
      error?.(err)
    }
  },
}

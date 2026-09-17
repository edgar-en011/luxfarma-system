# LuxFarma — Sistema de Gestión de Farmacia

Aplicación de escritorio (Electron) y web (Vite + React) para operar una botica: punto de venta, inventario, compras, turnos de caja y reportes.

## Stack

- React 19 + Vite
- Supabase (PostgreSQL + Auth de datos)
- SQLite local en Electron (modo offline)
- Impresión térmica ESC/POS 80 mm
- Electron Builder (instalador Windows)

## Requisitos

- Node.js 20 o superior
- npm

## Instalación

```bash
npm install
```

Copia `.env.example` a `.env` y completa las variables públicas de Supabase.

```bash
cp .env.example .env
```

En Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Variables de entorno

Ver `.env.example`. Las únicas requeridas para arrancar la UI son:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`VITE_FACTURACION_ELECTRONICA` controla Boleta/Factura SUNAT. Por defecto `false`: el POS emite Nota de Venta y no aparecen las pantallas SUNAT.

No pongas secretos (service role, tokens Nubefact) en el frontend.

## Desarrollo

```bash
npm run dev
```

Escritorio con Electron:

```bash
npm run electron:dev
```

## Build

```bash
npm run build
npm run electron:build
```

El instalador queda en `release/` como `LuxFarma-Setup-<versión>.exe`.

## Identidad de la empresa

Los datos de ticket (nombre, RUC, dirección) viven en `src/config/empresa.js` y se usan como respaldo si la sucursal en Supabase no trae esos campos.

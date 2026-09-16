# Publicar una versión (auto-actualización)

El instalador ya no se reparte solo por carpeta. Cada versión publicada va al bucket público de Supabase Storage `app-updates`. Las PCs con Salud Futura **0.5.0 o superior** revisan ese feed al iniciar y cada 1 hora. Si hay novedad, descargan e instalan en segundo plano y avisan que hay que cerrar y volver a abrir.

Las versiones **0.4.9 e inferiores no se auto-actualizan** (aún no traían el actualizador). Esas PCs hay que actualizarlas una vez a mano con el instalador 0.5.0+; a partir de ahí el ciclo es automático.

## Qué archivos viven en el bucket

En `https://<proyecto>.supabase.co/storage/v1/object/public/app-updates/`:

| Archivo | Para qué |
|---|---|
| `latest.yml` | Metadata que lee electron-updater (versión, sha512, nombre del exe) |
| `SaludFutura-Setup-X.Y.Z.exe` | Instalador NSIS de esa versión |
| `SaludFutura-Setup-X.Y.Z.exe.blockmap` | Descarga diferencial (si existe) |

## Publicar (reemplaza el método manual)

En la PC de desarrollo (esta, con el repo):

0. (Solo la primera vez) Corre `sql/crear_bucket_app_updates.sql` en el SQL Editor de Supabase.

1. Sube el `version` en `package.json`, `package-lock.json` y el fallback de `src/appVersion.js` (ej. `0.5.0` → `0.5.1`).
2. Corre `npm run lint` y `npm run build` (0 errores).
3. Pon la clave de servicio **solo en esta máquina**, nunca en el instalador ni en git:
   - variable de entorno `SUPABASE_SERVICE_ROLE_KEY`, o
   - una línea en `.env` (el archivo ya está fuera de git).
4. Corre:

```
npm run electron:publish
```

Eso hace, en orden:

- `ELECTRON=1 vite build`
- `electron-builder --win --publish never` (salida en `release\`)
- crea/actualiza el bucket `app-updates` (público, límite ~220 MB)
- sube `latest.yml` + `.exe` + `.blockmap` desde `release\`

5. Comprueba en el navegador (debe bajar, no 404):

`https://pbtzxmjrwzpkligufcve.supabase.co/storage/v1/object/public/app-updates/latest.yml`

## Qué hace cada PC ya instalada

- Al abrir, espera ~5 s y revisa `latest.yml` (silencioso si no hay nada nuevo).
- Mientras la app sigue abierta, vuelve a revisar **cada 1 hora**.
- Si hay versión mayor: barra discreta “Descargando actualización…” → “Instalando…”. Se puede seguir vendiendo.
- Al terminar: modal *“Nueva actualización instalada. Cierra y vuelve a abrir el sistema para que los cambios se apliquen.”*
- Al cerrar la app, NSIS aplica el instalador. El Login de la siguiente apertura muestra `vX.Y.Z` nueva.

No hace falta tocar la PC remota. Tampoco hace falta GitHub Releases.

## Primera vez en una sucursal vieja (≤ 0.4.9)

Instala a mano `release\SaludFutura-Setup-0.5.0.exe` (o la última publicada). Después de esa instalación, las siguientes versiones llegan solas.

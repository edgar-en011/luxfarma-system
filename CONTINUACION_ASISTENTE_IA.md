# Continuación del Asistente IA

## Estado actual

La primera versión del módulo está implementada en `/admin-asistente-ia` y limitada al rol Administrador. Incluye análisis determinístico de stock bajo, vencimientos, baja rotación, mayor movimiento y reposición, además de una conversación opcional mediante Supabase Edge Functions y OpenAI.

El stock continúa calculándose desde `inventario_lotes.cantidad_actual` en unidades base. No se modificaron ventas, compras, FEFO, Kardex, lotes ni sincronización offline.

## Despliegue realizado (16 de octubre de 2026)

- Repositorio vinculado al proyecto Supabase `luxfarma`.
- Migración de seguridad aplicada y registrada como
  `supabase/migrations/20261016120000_asistente_ia_seguridad.sql`.
- Edge Function `asistente-ia` desplegada correctamente.
- `OPENAI_API_KEY` configurada directamente como secret de Supabase.
- `OPENAI_MODEL=gpt-6-luna` configurado.
- `AI_ALLOWED_ORIGINS` configurado para desarrollo local y Electron.
- CORS y endpoint verificados: `OPTIONS 200` y una acción inválida devuelve
  el error controlado `400 INVALID_ACTION`.
- RPC `resumen_asistente_ia` desplegada: PostgreSQL calcula stock, ventas,
  rotación, vencimientos y reposición antes de responder al frontend.
- La RPC limita cada categoría a 10 elementos y no devuelve ventas ni lotes
  completos. El cálculo local anterior permanece como respaldo temporal.

## Pendiente para habilitar las respuestas reales

1. Probar la reautenticación y una consulta real con un administrador activo.
2. Validar visualmente las cinco tarjetas por sede cuando existan más datos.
3. Revisar logs, consumo y límites antes de habilitarlo en producción.

## Comprobaciones realizadas

- `node scripts/test-asistente-ia-analitica.mjs`: aprobado.
- `node scripts/test-asistente-ia-rpc.mjs`: aprobado contra Supabase real.
- `npm run lint`: aprobado sin errores; permanecen advertencias preexistentes.
- `npm run build`: aprobado.
- Bundle revisado sin claves privadas ni llamadas directas a OpenAI desde el frontend.

No colocar secretos en variables `VITE_*`, React, localStorage ni archivos versionados.

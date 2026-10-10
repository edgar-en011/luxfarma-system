# Continuación del Asistente IA

## Estado actual

La primera versión del módulo está implementada en `/admin-asistente-ia` y limitada al rol Administrador. Incluye análisis determinístico de stock bajo, vencimientos, baja rotación, mayor movimiento y reposición, además de una conversación opcional mediante Supabase Edge Functions y OpenAI.

El stock continúa calculándose desde `inventario_lotes.cantidad_actual` en unidades base. No se modificaron ventas, compras, FEFO, Kardex, lotes ni sincronización offline.

## Pendiente para la próxima sesión

1. Ejecutar `sql/migracion_asistente_ia_seguridad.sql` en Supabase.
2. Configurar `OPENAI_API_KEY`, `OPENAI_MODEL` y `AI_ALLOWED_ORIGINS` como secrets de la Edge Function.
3. Desplegar `supabase/functions/asistente-ia`.
4. Probar la reautenticación y una consulta real con un administrador activo.
5. Validar los datos de las cinco tarjetas contra registros reales de cada sede.
6. Revisar logs, consumo y límites antes de habilitarlo en producción.

## Comprobaciones realizadas

- `node scripts/test-asistente-ia-analitica.mjs`: aprobado.
- `npm run lint`: aprobado sin errores; permanecen advertencias preexistentes.
- `npm run build`: aprobado.
- Bundle revisado sin claves privadas ni llamadas directas a OpenAI desde el frontend.

No colocar secretos en variables `VITE_*`, React, localStorage ni archivos versionados.

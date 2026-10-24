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

## Ajustes de acceso (24 de octubre de 2026)

- La API key permanece exclusivamente en los secretos de Supabase y nunca se
  escribe en React, archivos `.env` del cliente, localStorage ni el instalador.
- El login del administrador obtiene automáticamente una autorización temporal
  de IA. La pantalla ya no solicita una segunda contraseña.
- Cada PC mantiene una autorización efímera durante la sesión abierta (máximo
  12 horas); iniciar desde otro equipo no invalida el primero. El usuario nunca
  ve ni configura ese token y el servidor conserva únicamente su hash.
- La memoria conversacional se limpia después de 10 minutos sin preguntas,
  pero eso no cierra ni invalida la autorización del administrador.
- El resumen gerencial se obtiene mediante la Edge Function después de validar
  al administrador. La anon key ya no puede ejecutar directamente la RPC.
- Las consultas clínicas, ajenas a LuxFarma o que intenten cambiar las reglas
  se rechazan antes de consumir una llamada al proveedor de IA.
- Las consultas de stock actual ya no se delegan al modelo: buscan el producto
  por nombre o código y calculan directamente los lotes. La respuesta separa
  disponible (`VIGENTE`), vencido/no vendible y stock físico registrado.
- Las consultas sugeridas vuelven a responderse con el modelo para conservar
  una conversación natural, usando el resumen real y hasta seis mensajes de
  contexto. Solo el stock exacto conserva una respuesta determinística.
- La vista muestra cobertura de inventario y advierte cuando existe catálogo
  pero no hay lotes sincronizados, evitando presentar ceros como una estimación.

## Despliegue de estos ajustes

- Edge Function `asistente-ia` desplegada nuevamente el 24 de octubre de 2026
  con sesiones independientes por equipo y contexto conversacional.
- Pendiente aplicar `supabase/migrations/20261024120000_asistente_ia_solo_admin.sql`
  para cerrar el acceso directo de la anon key a la RPC.
- No volver a configurar `OPENAI_API_KEY` o `GEMINI_API_KEY` en cada PC: el
   secreto ya configurado pertenece al proyecto remoto de Supabase.

## Pendiente para habilitar las respuestas reales

1. Probar la reautenticación y una consulta real con un administrador activo.
2. Validar visualmente las cinco tarjetas por sede cuando existan más datos.
3. Revisar logs, consumo y límites antes de habilitarlo en producción.

## Comprobaciones realizadas

- `node scripts/test-asistente-ia-analitica.mjs`: aprobado.
- `node scripts/test-asistente-ia-rpc.mjs`: comprueba que la anon key no pueda
  leer el resumen después de aplicar la migración de seguridad.
- `node scripts/test-asistente-ia-alcance.mjs`: comprueba el filtro temático.
- `node scripts/test-asistente-ia-stock.mjs`: valida búsqueda y separación de
  stock vigente, vencido y físico.
- `node scripts/auditar-asistente-ia-stock.mjs`: compara el resumen con los
  lotes reales de Supabase sin modificar datos.
- `node scripts/test-asistente-ia-edge.mjs`: confirma contra Supabase que está
  desplegado el flujo nuevo y que exige una sesión válida.
- `npm run lint`: aprobado sin errores; permanecen advertencias preexistentes.
- `npm run build`: aprobado.
- Bundle revisado sin claves privadas ni llamadas directas a OpenAI desde el frontend.

No colocar secretos en variables `VITE_*`, React, localStorage ni archivos versionados.

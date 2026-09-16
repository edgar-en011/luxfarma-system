-- Fecha en que detectamos la aceptación de SUNAT (para "Aceptada en N días").
-- Además devuelve a ENVIADO las filas que habían quedado en SIN_CONFIRMAR:
-- ese valor era de validación, no de envío. El CHECK viejo no se toca.

ALTER TABLE comprobantes_sunat
  ADD COLUMN IF NOT EXISTS fecha_aceptacion TIMESTAMPTZ;

UPDATE comprobantes_sunat
SET fecha_aceptacion = COALESCE(fecha_aceptacion, fecha_actualizacion, fecha_envio)
WHERE aceptada_por_sunat = TRUE
  AND fecha_aceptacion IS NULL;

UPDATE comprobantes_sunat
SET estado_envio = 'ENVIADO',
    fecha_actualizacion = NOW()
WHERE estado_envio = 'SIN_CONFIRMAR';

NOTIFY pgrst, 'reload schema';

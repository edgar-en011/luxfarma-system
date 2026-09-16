-- POR_CONFIRMAR: el envío a Nubefact abortó (p. ej. timeout) y no sabemos
-- si el comprobante se creó. Obliga a consultar_comprobante antes de
-- volver a generar. No reemplaza SIN_CONFIRMAR (eje de validación SUNAT).

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.comprobantes_sunat'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%estado_envio%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE comprobantes_sunat DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE comprobantes_sunat
  ADD CONSTRAINT comprobantes_sunat_estado_envio_check
  CHECK (estado_envio IN (
    'PENDIENTE',
    'ENVIADO',
    'ACEPTADO',
    'RECHAZADO',
    'ERROR',
    'REQUIERE_REVISION',
    'SIN_CONFIRMAR',
    'POR_CONFIRMAR'
  ));

NOTIFY pgrst, 'reload schema';

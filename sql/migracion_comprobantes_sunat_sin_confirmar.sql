-- Permite el estado SIN_CONFIRMAR: Nubefact aceptó el envío pero SUNAT
-- no confirmó la boleta tras el plazo del Resumen Diario (2 días o más).
-- Sin este CHECK, el UPDATE del ciclo de verificación falla.

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
    'SIN_CONFIRMAR'
  ));

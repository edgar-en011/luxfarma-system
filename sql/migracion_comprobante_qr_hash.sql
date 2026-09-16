-- Campos Nubefact para el ticket térmico (QR / hash / enlace).
-- Opcional: si no se ejecuta, el ticket de la venta en curso igual lleva
-- QR/hash porque se pasan en memoria. Sirve para reimpresiones posteriores.

ALTER TABLE comprobantes_sunat ADD COLUMN IF NOT EXISTS cadena_qr TEXT;
ALTER TABLE comprobantes_sunat ADD COLUMN IF NOT EXISTS codigo_hash TEXT;
ALTER TABLE comprobantes_sunat ADD COLUMN IF NOT EXISTS enlace TEXT;

NOTIFY pgrst, 'reload schema';

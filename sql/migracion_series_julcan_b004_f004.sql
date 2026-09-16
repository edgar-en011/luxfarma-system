-- Julcán: series SUNAT B003→B004 y F003→F004.
-- Las 7 boletas B003-2..B003-8 del 02/09 NO se tocan (comprobantes_sunat / ventas).
--
-- Boletas: ultimo_numero = 7  →  la siguiente que emita el sistema es B004-8
--          (B004-1 a B004-7 se reemiten a mano en Nubefact).
-- Facturas: ultimo_numero = 0  →  la primera es F004-1.
--
-- Ejecutar en Supabase SQL Editor. Idempotente: si ya está en B004/F004, no hace nada.

DO $$
DECLARE
  v_sucursal int;
  v_boletas int;
  v_facturas int;
BEGIN
  SELECT id_sucursal INTO v_sucursal
    FROM sucursales
   WHERE nombre_comercial ILIKE '%julc%'
   ORDER BY id_sucursal
   LIMIT 1;

  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'No se encontró la sucursal Julcán.';
  END IF;

  UPDATE series_correlativos
     SET serie = 'B004',
         ultimo_numero = 7
   WHERE id_sucursal = v_sucursal
     AND tipo_comprobante = 2
     AND serie = 'B003';
  GET DIAGNOSTICS v_boletas = ROW_COUNT;

  UPDATE series_correlativos
     SET serie = 'F004',
         ultimo_numero = 0
   WHERE id_sucursal = v_sucursal
     AND tipo_comprobante = 1
     AND serie = 'F003';
  GET DIAGNOSTICS v_facturas = ROW_COUNT;

  IF v_boletas = 0 AND v_facturas = 0 THEN
    IF EXISTS (
          SELECT 1 FROM series_correlativos
           WHERE id_sucursal = v_sucursal AND tipo_comprobante = 2
             AND serie = 'B004' AND ultimo_numero = 7
        )
       AND EXISTS (
          SELECT 1 FROM series_correlativos
           WHERE id_sucursal = v_sucursal AND tipo_comprobante = 1
             AND serie = 'F004' AND ultimo_numero = 0
        )
    THEN
      RAISE NOTICE 'Julcán (sucursal %) ya tiene B004/F004 con los correlativos esperados. Nada que actualizar.', v_sucursal;
    ELSE
      RAISE EXCEPTION 'Julcán (sucursal %) no tiene filas B003/F003 para actualizar. Revisa series_correlativos.', v_sucursal;
    END IF;
  ELSE
    RAISE NOTICE 'Julcán sucursal %: boletas actualizadas=%, facturas actualizadas=%.', v_sucursal, v_boletas, v_facturas;
  END IF;
END $$;

SELECT s.id,
       s.id_sucursal,
       suc.nombre_comercial,
       CASE s.tipo_comprobante WHEN 1 THEN 'Factura' WHEN 2 THEN 'Boleta' ELSE s.tipo_comprobante::text END AS tipo,
       s.serie,
       s.ultimo_numero,
       s.activo
  FROM series_correlativos s
  JOIN sucursales suc ON suc.id_sucursal = s.id_sucursal
 WHERE suc.nombre_comercial ILIKE '%julc%'
 ORDER BY s.tipo_comprobante;

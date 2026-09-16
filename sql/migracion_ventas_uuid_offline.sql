-- ═══════════════════════════════════════════════════
-- MIGRACIÓN: uuid_venta + RPC atómica de sync offline
-- Ejecutar en Supabase SQL Editor
-- No toca políticas RLS de ventas (solo agrega columna e índice).
-- La función sincronizar_venta_offline se REEMPLAZA en
-- migracion_correlativo_stock_atomico.sql (correlativo con lock + stock atómico).
-- ═══════════════════════════════════════════════════

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS uuid_venta UUID;

-- UNIQUE solo cuando hay valor: las ventas online/históricas quedan en NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ventas_uuid_venta
  ON ventas (uuid_venta)
  WHERE uuid_venta IS NOT NULL;

CREATE OR REPLACE FUNCTION sincronizar_venta_offline(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_uuid uuid;
  v_existente ventas%ROWTYPE;
  v_id_venta integer;
  v_correlativo integer;
  v_serie text;
  v_id_cliente integer;
  v_nro_doc text;
  v_nombre text;
  v_tipo_doc text;
  v_es_dni boolean;
  v_item jsonb;
  v_pago jsonb;
  v_id_producto integer;
  v_qty_base numeric;
  v_restante numeric;
  v_lote record;
  v_descontar numeric;
  v_nueva numeric;
  v_saldo numeric;
  v_faltante numeric;
  v_faltantes jsonb := '[]'::jsonb;
  v_lote_ref text;
BEGIN
  BEGIN
    v_uuid := (p_payload->>'uuid_venta')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UUID_INVALIDO');
  END;

  IF v_uuid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UUID_REQUERIDO');
  END IF;

  SELECT * INTO v_existente
  FROM ventas
  WHERE uuid_venta = v_uuid;

  -- Intento previo ya commitó venta+detalle+pagos+stock+kardex.
  -- No rehacer nada de eso: el cliente solo marca local y sigue con SUNAT.
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'ya_existia', true,
      'id_venta', v_existente.id_venta,
      'serie', v_existente.serie,
      'correlativo', v_existente.correlativo,
      'faltantes', '[]'::jsonb
    );
  END IF;

  IF COALESCE(p_payload->>'id_sucursal', '') = ''
     OR COALESCE(p_payload->>'id_turno', '') = ''
     OR COALESCE(p_payload->>'id_usuario', '') = ''
     OR COALESCE(p_payload->>'serie', '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DATOS_INCOMPLETOS');
  END IF;

  v_serie := p_payload->>'serie';

  SELECT COALESCE(MAX(correlativo), 0) + 1
    INTO v_correlativo
  FROM ventas
  WHERE serie = v_serie;

  INSERT INTO ventas (
    id_sucursal,
    id_turno,
    id_usuario_vendedor,
    tipo_comprobante,
    serie,
    correlativo,
    total,
    vuelto,
    monto_recibido,
    estado_sunat,
    uuid_venta
  ) VALUES (
    (p_payload->>'id_sucursal')::int,
    (p_payload->>'id_turno')::int,
    (p_payload->>'id_usuario')::int,
    p_payload->>'tipo_comprobante',
    v_serie,
    v_correlativo,
    COALESCE((p_payload->>'total')::numeric, 0),
    COALESCE((p_payload->>'vuelto')::numeric, 0),
    COALESCE((p_payload->>'monto_recibido')::numeric, 0),
    COALESCE(p_payload->>'estado_sunat', 'PENDIENTE'),
    v_uuid
  )
  RETURNING id_venta INTO v_id_venta;

  -- Cliente (mismo criterio que POS/sync JS). Sin bloque cliente = no falla.
  IF p_payload->'cliente' IS NOT NULL AND jsonb_typeof(p_payload->'cliente') = 'object' THEN
    v_es_dni := COALESCE(p_payload->>'tipo_comprobante', '') <> 'FACTURA';
    v_nombre := NULLIF(trim(COALESCE(
      p_payload->'cliente'->>'nombreRazonSocial',
      CASE WHEN v_es_dni THEN trim(CONCAT_WS(' ',
        p_payload->'cliente'->>'nombres',
        p_payload->'cliente'->>'apellidos'
      )) ELSE COALESCE(p_payload->'cliente'->>'razonSocial', '') END
    )), '');
    v_nro_doc := NULLIF(trim(COALESCE(p_payload->'cliente'->>'docInput', '')), '');
    IF v_nro_doc IS NULL AND COALESCE((p_payload->'cliente'->>'ventaSinDoc')::boolean, false) THEN
      v_nro_doc := 'SD-' || v_id_venta::text;
    END IF;
    v_tipo_doc := NULLIF(trim(COALESCE(p_payload->'cliente'->>'tipoDoc', '')), '');
    IF v_tipo_doc IS NULL THEN
      IF COALESCE((p_payload->'cliente'->>'ventaSinDoc')::boolean, false)
         AND NULLIF(trim(COALESCE(p_payload->'cliente'->>'docInput', '')), '') IS NULL THEN
        v_tipo_doc := 'SIN_DOC';
      ELSIF v_es_dni THEN
        v_tipo_doc := 'DNI';
      ELSE
        v_tipo_doc := 'RUC';
      END IF;
    END IF;

    IF v_nro_doc IS NOT NULL AND v_nombre IS NOT NULL THEN
      INSERT INTO clientes (
        tipo_doc, nro_doc, nombre_razon_social, nombres, apellidos, direccion, sexo, updated_at
      ) VALUES (
        v_tipo_doc,
        v_nro_doc,
        v_nombre,
        CASE WHEN v_es_dni THEN NULLIF(p_payload->'cliente'->>'nombres', '') END,
        CASE WHEN v_es_dni THEN NULLIF(p_payload->'cliente'->>'apellidos', '') END,
        CASE WHEN v_es_dni THEN NULL ELSE NULLIF(p_payload->'cliente'->>'direccion', '') END,
        CASE WHEN v_es_dni THEN NULLIF(p_payload->'cliente'->>'sexo', '') END,
        NOW()
      )
      ON CONFLICT (nro_doc) DO UPDATE SET
        tipo_doc = EXCLUDED.tipo_doc,
        nombre_razon_social = EXCLUDED.nombre_razon_social,
        nombres = EXCLUDED.nombres,
        apellidos = EXCLUDED.apellidos,
        direccion = EXCLUDED.direccion,
        sexo = EXCLUDED.sexo,
        updated_at = NOW()
      RETURNING id_cliente INTO v_id_cliente;

      UPDATE ventas SET id_cliente = v_id_cliente WHERE id_venta = v_id_venta;
    END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
  LOOP
    INSERT INTO venta_detalle (
      id_venta, id_producto, modo_venta, cantidad, precio_unitario, subtotal, factor, id_medida
    ) VALUES (
      v_id_venta,
      (v_item->>'id_producto')::int,
      COALESCE(v_item->>'modo_venta', 'UNIDAD'),
      COALESCE((v_item->>'cantidad')::numeric, 0),
      COALESCE((v_item->>'precio_unitario')::numeric, 0),
      COALESCE((v_item->>'subtotal')::numeric, 0),
      COALESCE((v_item->>'factor')::numeric, 1),
      NULLIF(v_item->>'id_medida', '')::int
    );
  END LOOP;

  FOR v_pago IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'pagos', '[]'::jsonb))
  LOOP
    INSERT INTO pagos_venta (id_venta, metodo, monto) VALUES (
      v_id_venta,
      v_pago->>'metodo',
      COALESCE((v_pago->>'monto')::numeric, 0)
    );
  END LOOP;

  -- FEFO + kardex (mismo criterio que syncEngine.js). FOR UPDATE evita carrera entre cajas.
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
  LOOP
    v_id_producto := (v_item->>'id_producto')::int;
    v_qty_base := COALESCE((v_item->>'cantidad')::numeric, 0)
      * COALESCE((v_item->>'factor')::numeric, 1);
    v_restante := v_qty_base;
    v_lote_ref := COALESCE(NULLIF(v_item->>'lote', ''), 'VENTA');

    FOR v_lote IN
      SELECT id_lote, cantidad_actual
      FROM inventario_lotes
      WHERE id_producto = v_id_producto
        AND id_sucursal = (p_payload->>'id_sucursal')::int
        AND estado = 'VIGENTE'
        AND cantidad_actual > 0
      ORDER BY fecha_vencimiento ASC NULLS LAST
      FOR UPDATE
    LOOP
      EXIT WHEN v_restante <= 0;
      v_descontar := LEAST(v_restante, v_lote.cantidad_actual);
      v_nueva := v_lote.cantidad_actual - v_descontar;
      UPDATE inventario_lotes
      SET cantidad_actual = v_nueva,
          estado = CASE WHEN v_nueva <= 0 THEN 'AGOTADO' ELSE 'VIGENTE' END
      WHERE id_lote = v_lote.id_lote;
      v_restante := v_restante - v_descontar;
    END LOOP;

    SELECT COALESCE(SUM(cantidad_actual), 0) INTO v_saldo
    FROM inventario_lotes
    WHERE id_producto = v_id_producto
      AND id_sucursal = (p_payload->>'id_sucursal')::int
      AND estado = 'VIGENTE';

    v_faltante := GREATEST(v_restante, 0);
    IF v_faltante > 0 THEN
      v_faltantes := v_faltantes || jsonb_build_array(jsonb_build_object(
        'id_producto', v_id_producto,
        'faltante', v_faltante,
        'saldo', v_saldo,
        'nombre', COALESCE(v_item->>'nombre', 'Producto #' || v_id_producto)
      ));
    END IF;

    INSERT INTO kardex_movimientos (
      id_sucursal, id_producto, tipo, cantidad, saldo, id_lote, id_usuario, observacion
    ) VALUES (
      (p_payload->>'id_sucursal')::int,
      v_id_producto,
      'SALIDA',
      v_qty_base,
      v_saldo,
      v_lote_ref,
      (p_payload->>'id_usuario')::int,
      CASE WHEN v_faltante > 0 THEN
        'REQUIERE REVISIÓN: no había stock suficiente al sincronizar esta venta offline — faltaron '
        || v_faltante::text || ' unidad(es) base que no se pudieron descontar de ningún lote.'
      ELSE NULL END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'ya_existia', false,
    'id_venta', v_id_venta,
    'serie', v_serie,
    'correlativo', v_correlativo,
    'faltantes', v_faltantes
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Carrera: otro request con el mismo uuid commitó primero.
    SELECT * INTO v_existente FROM ventas WHERE uuid_venta = v_uuid;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'ya_existia', true,
        'id_venta', v_existente.id_venta,
        'serie', v_existente.serie,
        'correlativo', v_existente.correlativo,
        'faltantes', '[]'::jsonb
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION sincronizar_venta_offline(jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

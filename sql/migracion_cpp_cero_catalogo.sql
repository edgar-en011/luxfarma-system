-- ===========================================================
-- CPP 0 (todo el stock vigente es bonificado) graba producto_precios.costo = 0.
-- Antes se conservaba el costo viejo (el 0.01 placeholder).
--
-- Ejecutar en Supabase SQL Editor (CREATE OR REPLACE, seguro re-ejecutar).
-- Mismo cuerpo que migracion_lotes_compra_por_linea.sql.
-- No altera tablas. Reemplaza registrar_compra.
-- ===========================================================

CREATE OR REPLACE FUNCTION registrar_compra(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_existente compras%ROWTYPE;
  v_id_compra bigint;
  v_id_sucursal integer;
  v_id_proveedor integer;
  v_id_usuario integer;
  v_tipo text;
  v_serie text;
  v_numero text;
  v_nro_doc text;
  v_forma text;
  v_item jsonb;
  v_items_resueltos jsonb;
  v_id_producto integer;
  v_qty numeric;
  v_costo numeric;
  v_lote text;
  v_fv date;
  v_fv_lote date;
  v_id_lote bigint;
  v_saldo numeric;
  v_codigo text;
  v_nombre text;
  v_pventa numeric;
  v_pcaja numeric;
  v_pedido integer;
  v_n integer;
  v_i integer;
  v_es_bonif boolean;
  v_stock_antes numeric;
  v_costo_antes numeric;
  v_costo_lote numeric;
  v_cpp_producto numeric;
  v_actualiza_precios boolean;
  v_compatible boolean;
  v_lote_pedido text;
BEGIN
  v_id_sucursal := NULLIF(p_payload->>'id_sucursal', '')::int;
  v_id_proveedor := NULLIF(p_payload->>'id_proveedor', '')::int;
  v_id_usuario := NULLIF(p_payload->>'id_usuario', '')::int;
  v_tipo := NULLIF(btrim(COALESCE(p_payload->>'tipo_comprobante', '')), '');
  v_serie := NULLIF(btrim(COALESCE(p_payload->>'serie', '')), '');
  v_numero := NULLIF(btrim(COALESCE(p_payload->>'numero', '')), '');
  v_nro_doc := NULLIF(btrim(COALESCE(p_payload->>'nro_documento', '')), '');
  v_forma := NULLIF(btrim(COALESCE(p_payload->>'forma_pago', 'Contado')), '');
  v_pedido := NULLIF(p_payload->>'id_pedido_origen', '')::int;
  v_actualiza_precios := COALESCE((p_payload->>'actualiza_precios')::boolean, false);

  IF v_id_sucursal IS NULL OR v_id_proveedor IS NULL OR v_id_usuario IS NULL
     OR v_tipo IS NULL OR v_serie IS NULL OR v_numero IS NULL
     OR COALESCE(p_payload->>'fecha_compra', '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DATOS_INCOMPLETOS');
  END IF;

  IF v_nro_doc IS NULL THEN
    v_nro_doc := v_serie || '-' || v_numero;
  END IF;

  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_ITEMS');
  END IF;

  SELECT * INTO v_existente
  FROM compras
  WHERE id_proveedor = v_id_proveedor
    AND tipo_comprobante = v_tipo
    AND serie = v_serie
    AND numero = v_numero
    AND COALESCE(estado_anulacion, '') IS DISTINCT FROM 'ANULADO';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'ya_existia', true,
      'id_compra', v_existente.id_compra
    );
  END IF;

  INSERT INTO compras (
    id_sucursal,
    id_proveedor,
    nro_documento,
    tipo_comprobante,
    serie,
    numero,
    fecha_compra,
    total_compra,
    id_usuario_registro,
    forma_pago,
    fecha_vencimiento,
    estado_pago,
    monto_pagado,
    compra_origen_id,
    id_pedido_origen,
    total_editado_manualmente,
    total_calculado_original,
    percepcion
  ) VALUES (
    v_id_sucursal,
    v_id_proveedor,
    v_nro_doc,
    v_tipo,
    v_serie,
    v_numero,
    (p_payload->>'fecha_compra')::date,
    COALESCE((p_payload->>'total_compra')::numeric, 0),
    v_id_usuario,
    v_forma,
    NULLIF(p_payload->>'fecha_vencimiento', '')::date,
    CASE WHEN v_forma = 'Crédito' THEN 'PENDIENTE' ELSE 'PAGADO' END,
    CASE WHEN v_forma = 'Crédito' THEN 0 ELSE COALESCE((p_payload->>'total_compra')::numeric, 0) END,
    NULLIF(p_payload->>'compra_origen_id', '')::int,
    v_pedido,
    COALESCE((p_payload->>'total_editado_manualmente')::boolean, false),
    NULLIF(p_payload->>'total_calculado_original', '')::numeric,
    COALESCE((p_payload->>'percepcion')::numeric, 0)
  )
  RETURNING id_compra INTO v_id_compra;

  IF v_forma IS DISTINCT FROM 'Crédito'
     AND COALESCE((p_payload->>'total_compra')::numeric, 0) > 0 THEN
    INSERT INTO pagos_compra (id_compra, monto, fecha_pago, metodo_pago, id_usuario)
    VALUES (
      v_id_compra,
      (p_payload->>'total_compra')::numeric,
      (p_payload->>'fecha_compra')::date,
      'Efectivo',
      v_id_usuario
    );
  END IF;

  IF v_pedido IS NOT NULL THEN
    UPDATE pedidos_proveedor
    SET estado = 'RECIBIDO'
    WHERE id_pedido = v_pedido;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'No se pudo marcar el pedido #% como RECIBIDO.', v_pedido;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(item_resuelto ORDER BY ord), '[]'::jsonb)
  INTO v_items_resueltos
  FROM (
    WITH raw AS (
      SELECT
        (t.ord)::int AS ord,
        t.item,
        (NULLIF(t.item->>'id_producto', ''))::int AS id_producto,
        COALESCE(
          NULLIF(btrim(COALESCE(t.item->>'nro_lote', '')), ''),
          'FAC-' || v_nro_doc
        ) AS lote_base,
        round(COALESCE((t.item->>'costo_unitario')::numeric, 0), 6) AS costo,
        NULLIF(t.item->>'fecha_vencimiento', '')::date AS fv
      FROM jsonb_array_elements(p_payload->'items') WITH ORDINALITY AS t(item, ord)
    ),
    grupos AS (
      SELECT
        id_producto,
        lote_base,
        costo,
        fv,
        COUNT(*) OVER (PARTITION BY id_producto, lote_base) AS n_grupos,
        ROW_NUMBER() OVER (
          PARTITION BY id_producto, lote_base
          ORDER BY costo, fv NULLS FIRST
        ) AS rn
      FROM (
        SELECT DISTINCT id_producto, lote_base, costo, fv FROM raw
      ) d
    )
    SELECT
      r.ord,
      r.item || jsonb_build_object(
        'nro_lote',
        CASE
          WHEN g.n_grupos <= 1 THEN r.lote_base
          ELSE r.lote_base || '-' || g.rn::text
        END
      ) AS item_resuelto
    FROM raw r
    JOIN grupos g
      ON g.id_producto = r.id_producto
     AND g.lote_base = r.lote_base
     AND g.costo = r.costo
     AND g.fv IS NOT DISTINCT FROM r.fv
  ) x;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items_resueltos)
  LOOP
    v_id_producto := NULLIF(v_item->>'id_producto', '')::int;
    v_qty := COALESCE((v_item->>'cantidad')::numeric, 0);
    v_costo := COALESCE((v_item->>'costo_unitario')::numeric, 0);
    v_lote := NULLIF(btrim(COALESCE(v_item->>'nro_lote', '')), '');
    v_fv := NULLIF(v_item->>'fecha_vencimiento', '')::date;
    v_codigo := NULLIF(btrim(COALESCE(v_item->>'codigo_proveedor', '')), '');
    v_nombre := NULLIF(btrim(COALESCE(v_item->>'descripcion_catalogo', '')), '');
    v_pventa := COALESCE((v_item->>'p_venta')::numeric, 0);
    v_pcaja := COALESCE((v_item->>'p_venta_caja')::numeric, 0);

    IF v_id_producto IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO';
    END IF;

    IF v_lote IS NULL THEN
      v_lote := 'FAC-' || v_nro_doc;
    END IF;

    v_es_bonif := COALESCE((v_item->>'bonificacion')::boolean, false) OR v_costo <= 0;

    v_lote_pedido := v_lote;
    v_i := 0;
    LOOP
      v_id_lote := NULL;
      v_stock_antes := NULL;
      v_costo_antes := NULL;
      v_fv_lote := NULL;

      SELECT id_lote, cantidad_actual, costo_unitario_lote, fecha_vencimiento
        INTO v_id_lote, v_stock_antes, v_costo_antes, v_fv_lote
      FROM inventario_lotes
      WHERE id_producto = v_id_producto
        AND id_sucursal = v_id_sucursal
        AND nro_lote = v_lote
      FOR UPDATE;

      v_compatible := v_id_lote IS NULL
        OR (
          v_fv IS NOT DISTINCT FROM v_fv_lote
          AND (
            v_es_bonif
            OR COALESCE(v_stock_antes, 0) <= 0
            OR round(COALESCE(v_costo_antes, 0), 6) = round(v_costo, 6)
          )
        );

      IF v_compatible THEN
        EXIT;
      END IF;

      v_i := v_i + 1;
      v_lote := v_lote_pedido || '-' || v_i::text;
    END LOOP;

    INSERT INTO compra_detalle (
      id_compra, id_producto, nro_lote, fecha_vencimiento, cantidad, costo_unitario, subtotal
    ) VALUES (
      v_id_compra,
      v_id_producto,
      v_lote,
      v_fv,
      v_qty,
      v_costo,
      COALESCE((v_item->>'subtotal')::numeric, 0)
    );

    IF v_id_lote IS NULL THEN
      BEGIN
        IF v_es_bonif THEN
          SELECT COALESCE(
            round(
              SUM(cantidad_actual * costo_unitario_lote) / NULLIF(SUM(cantidad_actual), 0),
              6
            ),
            0
          )
          INTO v_costo_lote
          FROM inventario_lotes
          WHERE id_producto = v_id_producto
            AND estado = 'VIGENTE'
            AND cantidad_actual > 0;
        ELSE
          v_costo_lote := v_costo;
        END IF;

        INSERT INTO inventario_lotes (
          id_sucursal, id_producto, nro_lote, fecha_vencimiento,
          cantidad_actual, costo_unitario_lote, estado
        ) VALUES (
          v_id_sucursal, v_id_producto, v_lote, v_fv,
          v_qty, v_costo_lote, 'VIGENTE'
        )
        RETURNING id_lote INTO v_id_lote;
      EXCEPTION WHEN unique_violation THEN
        SELECT id_lote, cantidad_actual, costo_unitario_lote, fecha_vencimiento
          INTO v_id_lote, v_stock_antes, v_costo_antes, v_fv_lote
        FROM inventario_lotes
        WHERE id_producto = v_id_producto
          AND id_sucursal = v_id_sucursal
          AND nro_lote = v_lote
        FOR UPDATE;
        IF v_fv IS DISTINCT FROM v_fv_lote THEN
          RAISE EXCEPTION 'LOTE_VENCIMIENTO_CRUZADO';
        END IF;
        v_costo_lote := CASE
          WHEN v_es_bonif THEN COALESCE(v_costo_antes, 0)
          WHEN COALESCE(v_stock_antes, 0) <= 0 THEN v_costo
          ELSE round(
            (v_stock_antes * COALESCE(v_costo_antes, 0) + v_qty * v_costo)
              / (v_stock_antes + v_qty),
            6
          )
        END;
        UPDATE inventario_lotes
        SET cantidad_actual = COALESCE(v_stock_antes, 0) + v_qty,
            costo_unitario_lote = v_costo_lote,
            estado = 'VIGENTE'
        WHERE id_lote = v_id_lote;
      END;
    ELSE
      v_costo_lote := CASE
        WHEN v_es_bonif THEN COALESCE(v_costo_antes, 0)
        WHEN COALESCE(v_stock_antes, 0) <= 0 THEN v_costo
        ELSE round(
          (v_stock_antes * COALESCE(v_costo_antes, 0) + v_qty * v_costo)
            / (v_stock_antes + v_qty),
          6
        )
      END;
      UPDATE inventario_lotes
      SET cantidad_actual = COALESCE(v_stock_antes, 0) + v_qty,
          costo_unitario_lote = v_costo_lote,
          estado = 'VIGENTE'
      WHERE id_lote = v_id_lote;
    END IF;

    SELECT COALESCE(SUM(cantidad_actual), 0) INTO v_saldo
    FROM inventario_lotes
    WHERE id_producto = v_id_producto
      AND id_sucursal = v_id_sucursal
      AND estado = 'VIGENTE';

    INSERT INTO kardex_movimientos (
      id_sucursal, id_producto, tipo, cantidad, saldo, id_lote, id_usuario, observacion
    ) VALUES (
      v_id_sucursal, v_id_producto, 'ENTRADA', v_qty, v_saldo,
      v_lote, v_id_usuario, 'Compra ' || v_nro_doc
    );

    IF v_codigo IS NOT NULL THEN
      INSERT INTO producto_codigos_proveedor (id_producto, id_proveedor, codigo_proveedor)
      VALUES (v_id_producto, v_id_proveedor, v_codigo)
      ON CONFLICT (id_proveedor, codigo_proveedor)
      DO UPDATE SET id_producto = EXCLUDED.id_producto;
    END IF;

    SELECT COALESCE(
      round(
        SUM(cantidad_actual * costo_unitario_lote) / NULLIF(SUM(cantidad_actual), 0),
        6
      ),
      0
    )
    INTO v_cpp_producto
    FROM inventario_lotes
    WHERE id_producto = v_id_producto
      AND estado = 'VIGENTE'
      AND cantidad_actual > 0;

    -- p_venta: último de la factura. Un solo precio de venta por producto (intencional).
    -- CPP 0 (todo el stock vigente es bonificado) graba costo 0; no conserva un 0.01 viejo.
    UPDATE producto_precios
    SET
      costo = v_cpp_producto,
      precio_venta = CASE
        WHEN v_actualiza_precios AND v_pventa > 0 THEN v_pventa
        ELSE precio_venta
      END,
      precio_caja = CASE
        WHEN v_actualiza_precios AND v_pcaja > 0 THEN v_pcaja
        ELSE precio_caja
      END,
      ganancia = round(
        (CASE WHEN v_actualiza_precios AND v_pventa > 0 THEN v_pventa ELSE precio_venta END)
        - v_cpp_producto,
        4
      )
    WHERE id_producto = v_id_producto;

    IF v_nombre IS NOT NULL THEN
      UPDATE productos
      SET descripcion = v_nombre
      WHERE id_producto = v_id_producto;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'ya_existia', false,
    'id_compra', v_id_compra
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existente
    FROM compras
    WHERE id_proveedor = v_id_proveedor
      AND tipo_comprobante = v_tipo
      AND serie = v_serie
      AND numero = v_numero
      AND COALESCE(estado_anulacion, '') IS DISTINCT FROM 'ANULADO';
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'ya_existia', true,
        'id_compra', v_existente.id_compra
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  WHEN raise_exception THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_compra(jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

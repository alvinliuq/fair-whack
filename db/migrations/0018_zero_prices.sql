-- 27 Nov: PETstock listing cards read before their prices loaded were saved at $0.00 (with "Save $x" taken as the
-- was-price). Those prices are cleared (the product is hidden from browse and search until a run reads its real
-- price) and the $0 observations removed from price history.
DELETE FROM price_snapshot WHERE price_cents IS NOT NULL AND price_cents <= 0;
UPDATE retailer_product SET cur_price_cents = NULL, cur_was_cents = NULL, cur_is_special = 0, cur_promo_text = NULL, cur_promo_type = NULL, cur_unit_cents = NULL
  WHERE cur_price_cents IS NOT NULL AND cur_price_cents <= 0;

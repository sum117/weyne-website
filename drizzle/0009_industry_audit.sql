-- weyne:migration compatibility=expand previous-app-compatible=true
ALTER TABLE catalog_audit
  DROP CONSTRAINT IF EXISTS catalog_audit_operation_ck,
  DROP CONSTRAINT IF EXISTS catalog_audit_operation_check,
  ADD CONSTRAINT catalog_audit_operation_ck CHECK (
    operation IN (
      'industry.create',
      'industry.update',
      'industry.archive',
      'product.create',
      'product.update',
      'product.archive',
      'price.update'
    )
  ),
  DROP CONSTRAINT IF EXISTS catalog_audit_target_type_ck,
  DROP CONSTRAINT IF EXISTS catalog_audit_target_type_check,
  ADD CONSTRAINT catalog_audit_target_type_ck CHECK (
    target_type IN ('industry', 'product', 'product_price')
  );
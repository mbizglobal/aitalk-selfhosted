
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"inputVat","type":"money"}]'::jsonb)::text
WHERE template = 'vat.transactions@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"inputVat"}]'::jsonb);

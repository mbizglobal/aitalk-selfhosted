
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"eurIban","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"eurIban"}]'::jsonb);


UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"numberFormat","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"numberFormat"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"numberFormat","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"numberFormat"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"dateFormat","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"dateFormat"}]'::jsonb);

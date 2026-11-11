
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadHidesIds","type":"boolean"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadHidesIds"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadHidesIds","type":"boolean"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadHidesIds"}]'::jsonb);

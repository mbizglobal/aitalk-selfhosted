
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"taxNote","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"taxNote"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatModeUsed","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatModeUsed"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"taxNote","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"taxNote"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatModeUsed","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatModeUsed"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatMode","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatMode"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatRate","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatRate"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatMode","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatMode"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatRate","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatRate"}]'::jsonb);

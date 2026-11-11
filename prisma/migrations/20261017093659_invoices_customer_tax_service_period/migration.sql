
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatNumber","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"regNumber","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"regNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"customerNo","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"customerNo"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"reverseCharge","type":"boolean"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"reverseCharge"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"vatNumber","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"vatNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"regNumber","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"regNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"customerNo","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"customerNo"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"reverseCharge","type":"boolean"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"reverseCharge"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"serviceFrom","type":"date"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"serviceFrom"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"serviceTo","type":"date"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"serviceTo"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"serviceFrom","type":"date"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"serviceFrom"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"serviceTo","type":"date"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"serviceTo"}]'::jsonb);

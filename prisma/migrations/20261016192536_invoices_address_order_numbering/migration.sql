
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"addressLine2","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"addressLine2"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"addressLine2","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.customers@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"addressLine2"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"orderNo","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"orderNo"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"orderNo","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"orderNo"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"requestedNumber","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"requestedNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"requestedNumber","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"requestedNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"email","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"email"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"regNumber","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"regNumber"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"zeroTaxNote","type":"text"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"zeroTaxNote"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"dateFormat","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"dateFormat"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"numbering","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"numbering"}]'::jsonb);

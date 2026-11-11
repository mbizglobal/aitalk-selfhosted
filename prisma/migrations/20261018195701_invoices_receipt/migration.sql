
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptFileId","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptFileId"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptSha256","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptSha256"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptOn","type":"date"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptOn"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptAmount","type":"money"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptAmount"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptFingerprint","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptFingerprint"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptLinkToken","type":"string","encrypted":true}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptLinkToken"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptLinkExpiresOn","type":"date"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptLinkExpiresOn"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptFileId","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptFileId"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptSha256","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptSha256"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptOn","type":"date"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptOn"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptAmount","type":"money"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptAmount"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptFingerprint","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptFingerprint"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptLinkToken","type":"string","encrypted":true}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptLinkToken"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptLinkExpiresOn","type":"date"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptLinkExpiresOn"}]'::jsonb);

UPDATE work_project
SET modules = array_append(modules, 'invoices.payment-state')
WHERE kind = 'invoices'
  AND NOT ('invoices.payment-state' = ANY(modules));

UPDATE work_project
SET modules = array_append(modules, 'invoices.receipt')
WHERE kind = 'invoices'
  AND NOT ('invoices.receipt' = ANY(modules));

UPDATE work_project
SET modules = array_append(modules, 'swiss-acc.invoice.payment-state')
WHERE kind = 'swiss-acc-invoice'
  AND NOT ('swiss-acc.invoice.payment-state' = ANY(modules));

UPDATE work_project
SET modules = array_append(modules, 'swiss-acc.invoice.receipt')
WHERE kind = 'swiss-acc-invoice'
  AND NOT ('swiss-acc.invoice.receipt' = ANY(modules));

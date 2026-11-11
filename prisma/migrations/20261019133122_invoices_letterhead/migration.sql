
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadFileId","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadFileId"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadTop","type":"number"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadTop"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadBottom","type":"number"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadBottom"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadLeft","type":"number"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadLeft"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadRight","type":"number"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadRight"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadHidesCompany","type":"boolean"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadHidesCompany"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadFileId","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadFileId"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadTop","type":"number"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadTop"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadBottom","type":"number"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadBottom"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadLeft","type":"number"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadLeft"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadRight","type":"number"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadRight"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadHidesCompany","type":"boolean"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadHidesCompany"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadFileId","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadFileId"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadSha256","type":"string"}]'::jsonb)::text
WHERE template = 'invoices.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadSha256"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadFileId","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadFileId"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"letterheadSha256","type":"string"}]'::jsonb)::text
WHERE template = 'swiss-acc.invoice.invoices@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"letterheadSha256"}]'::jsonb);

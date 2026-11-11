
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"paymentDetailsCHF","type":"text"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"paymentDetailsCHF"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"paymentDetailsEUR","type":"text"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"paymentDetailsEUR"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"paymentDetailsGBP","type":"text"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"paymentDetailsGBP"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"paymentDetailsUSD","type":"text"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"paymentDetailsUSD"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"paymentDetailsKRW","type":"text"}]'::jsonb)::text
WHERE template = 'invoices.profile@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"paymentDetailsKRW"}]'::jsonb);

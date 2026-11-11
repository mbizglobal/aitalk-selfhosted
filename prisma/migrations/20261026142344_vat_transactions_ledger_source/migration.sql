
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"sourceFp","type":"string"}]'::jsonb)::text
WHERE template = 'vat.transactions@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"sourceFp"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"sourceSuggest","type":"json"}]'::jsonb)::text
WHERE template = 'vat.transactions@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"sourceSuggest"}]'::jsonb);

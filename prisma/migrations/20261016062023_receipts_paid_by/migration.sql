
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"paidBy","type":"string"}]'::jsonb)::text
WHERE "template" = 'receipts.receipts@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'paidBy');

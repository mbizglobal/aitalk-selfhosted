
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"type","type":"string"}]'::jsonb)::text
WHERE "template" = 'ledger.accounts@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'type');

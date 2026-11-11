
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"paidByName","type":"string","encrypted":true}]'::jsonb)::text
WHERE "template" = 'receipts.receipts@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'paidByName');
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"receiptLost","type":"boolean"}]'::jsonb)::text
WHERE "template" = 'receipts.receipts@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'receiptLost');
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"rejected","type":"text","encrypted":true}]'::jsonb)::text
WHERE "template" = 'receipts.bills@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'rejected');
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"cancelled","type":"date"}]'::jsonb)::text
WHERE "template" = 'receipts.bills@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'cancelled');

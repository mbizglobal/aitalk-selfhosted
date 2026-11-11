
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"refundOf","type":"string"}]'::jsonb)::text
WHERE "template" = 'receipts.receipts@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'refundOf');
UPDATE "data_sheets"
SET "schema" = jsonb_set("schema"::jsonb, '{columns}', ("schema"::jsonb -> 'columns') || '[{"name":"recurringKey","type":"string"}]'::jsonb)::text
WHERE "template" = 'receipts.receipts@1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("schema"::jsonb -> 'columns') AS c WHERE c ->> 'name' = 'recurringKey');

INSERT INTO "data_sheets" ("id", "kind", "user_id", "project_id", "name", "schema", "template", "template_family", "created_at", "updated_at")
SELECT 'x' || substr(md5(p."id" || ':receipts.bills'), 1, 24), 'project', p."user_id", p."id", 'Bills',
  '{"columns":[{"name":"docType","type":"string","required":true},{"name":"creditFor","type":"string"},{"name":"supplier","type":"string","required":true,"encrypted":true},{"name":"billNumber","type":"string"},{"name":"billDate","type":"date","required":true},{"name":"dueDate","type":"date"},{"name":"currency","type":"string","required":true},{"name":"amount","type":"money","required":true},{"name":"tax","type":"money"},{"name":"taxRate","type":"string"},{"name":"category","type":"string"},{"name":"country","type":"string"},{"name":"payTo","type":"string","encrypted":true},{"name":"payReference","type":"string"},{"name":"recurringKey","type":"string"},{"name":"billFileId","type":"string"},{"name":"moreFileIds","type":"string"},{"name":"approvalFileId","type":"string"},{"name":"note","type":"text","encrypted":true}]}',
  'receipts.bills@1', 'receipts.bills', NOW(), NOW()
FROM "work_project" p
WHERE p."kind" = 'receipts'
  AND NOT EXISTS (SELECT 1 FROM "data_sheets" s WHERE s."project_id" = p."id" AND s."template_family" = 'receipts.bills');
INSERT INTO "data_sheets" ("id", "kind", "user_id", "project_id", "name", "schema", "template", "template_family", "created_at", "updated_at")
SELECT 'x' || substr(md5(p."id" || ':receipts.recurring'), 1, 24), 'project', p."user_id", p."id", 'Fixed costs',
  '{"columns":[{"name":"recurringKey","type":"string","required":true},{"name":"name","type":"string","required":true},{"name":"supplier","type":"string","encrypted":true},{"name":"amount","type":"money"},{"name":"currency","type":"string"},{"name":"every","type":"string","required":true},{"name":"startMonth","type":"string","required":true},{"name":"endMonth","type":"string"},{"name":"payVia","type":"string"},{"name":"note","type":"text","encrypted":true}],"unique":["recurringKey"]}',
  'receipts.recurring@1', 'receipts.recurring', NOW(), NOW()
FROM "work_project" p
WHERE p."kind" = 'receipts'
  AND NOT EXISTS (SELECT 1 FROM "data_sheets" s WHERE s."project_id" = p."id" AND s."template_family" = 'receipts.recurring');

UPDATE "work_project" SET "modules" = array_append("modules", 'receipts.ledger-state')
WHERE "kind" = 'receipts' AND NOT ('receipts.ledger-state' = ANY("modules"));

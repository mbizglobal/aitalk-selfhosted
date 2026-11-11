
INSERT INTO "data_sheets" ("id", "user_id", "project_id", "kind", "template", "template_family", "name", "schema", "created_at", "updated_at")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || p."id"), 1, 24), p."user_id", p."id", 'project',
       'swiss-acc.year-end.receipt-accounts@1', 'swiss-acc.year-end.receipt-accounts', 'Receipt accounts',
       '{"columns":[{"name":"receipt","type":"string","required":true},{"name":"date","type":"date","required":true},{"name":"account","type":"string"},{"name":"skip","type":"boolean"},{"name":"nonDeductible","type":"boolean"},{"name":"aiReason","type":"text","encrypted":true},{"name":"note","type":"text","encrypted":true}],"unique":["receipt"]}', NOW(), NOW()
FROM "work_project" p
WHERE p."kind" = 'swiss-acc-year-end'
  AND NOT EXISTS (SELECT 1 FROM "data_sheets" d WHERE d."project_id" = p."id" AND d."template_family" = 'swiss-acc.year-end.receipt-accounts')
  AND NOT EXISTS (SELECT 1 FROM "data_sheets" d WHERE d."project_id" = p."id" AND d."name" = 'Receipt accounts');

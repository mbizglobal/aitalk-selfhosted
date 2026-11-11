
CREATE UNIQUE INDEX IF NOT EXISTS "work_send_app_once_key" ON "work_send"("project_id", "slot", "ref") WHERE "kind" = 'work_app' AND "slot" LIKE 'asend:%' AND "status" IN ('pending', 'sent') AND "ref" IS NOT NULL;

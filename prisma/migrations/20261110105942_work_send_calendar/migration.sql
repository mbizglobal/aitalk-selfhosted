
ALTER TABLE "work_send" DROP CONSTRAINT IF EXISTS "work_send_kind_check";
ALTER TABLE "work_send" ADD CONSTRAINT "work_send_kind_check"
  CHECK ("kind" IN ('email', 'telegram', 'http', 'db_write', 'db_sql', 'sms', 'call', 'work_app', 'calendar'));

CREATE UNIQUE INDEX IF NOT EXISTS "work_send_calendar_once_key" ON "work_send"("project_id", "declared", "ref") WHERE "kind" = 'calendar' AND "status" IN ('pending', 'sending', 'sent', 'unknown') AND "ref" IS NOT NULL;


ALTER TABLE "work_send" DROP CONSTRAINT IF EXISTS "work_send_kind_check";
ALTER TABLE "work_send" ADD CONSTRAINT "work_send_kind_check"
  CHECK ("kind" IN ('email', 'telegram', 'http', 'db_write', 'db_sql', 'sms', 'call', 'work_app'));

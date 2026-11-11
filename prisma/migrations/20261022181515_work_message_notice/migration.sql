
ALTER TABLE "work_message" DROP CONSTRAINT IF EXISTS work_message_role;
ALTER TABLE "work_message" ADD CONSTRAINT work_message_role CHECK ("role" IN ('user', 'assistant', 'notice'));

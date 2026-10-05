ALTER TABLE "work_task" DROP CONSTRAINT IF EXISTS work_task_status;
ALTER TABLE "work_task" ADD CONSTRAINT work_task_status CHECK ("status" IN ('open', 'awaiting', 'submitted'));

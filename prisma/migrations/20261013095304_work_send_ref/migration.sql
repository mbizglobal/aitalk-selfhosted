-- AlterTable
ALTER TABLE "work_send" ADD COLUMN     "ref" VARCHAR(25);

-- CreateIndex
CREATE INDEX "work_send_project_id_ref_idx" ON "work_send"("project_id", "ref");

ALTER TABLE "work_signal" DROP CONSTRAINT IF EXISTS "work_signal_kind_check";
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_kind_check" CHECK ("kind" IN ('sealed', 'resubmitted', 'unlocked', 'inbox_row', 'task_deleted', 'project_deleted', 'send_sent'));
ALTER TABLE "work_signal" DROP CONSTRAINT IF EXISTS "work_signal_task_check";
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_task_check" CHECK ("task_id" IS NOT NULL OR "kind" IN ('inbox_row', 'project_deleted', 'send_sent'));

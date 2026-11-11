-- AlterTable
ALTER TABLE "data_sheet_rows" ADD COLUMN     "channel_key" VARCHAR(64);

-- AlterTable
ALTER TABLE "work_signal" ALTER COLUMN "task_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "idx_sheet_channel_key" ON "data_sheet_rows"("sheet_id", "channel_key");

ALTER TABLE "work_signal" DROP CONSTRAINT "work_signal_kind_check";
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_kind_check" CHECK ("kind" IN ('sealed', 'resubmitted', 'unlocked', 'inbox_row'));
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_task_check" CHECK ("task_id" IS NOT NULL OR "kind" = 'inbox_row');

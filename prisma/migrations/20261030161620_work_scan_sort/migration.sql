-- AlterTable
ALTER TABLE "work_scan" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "attempt_id" VARCHAR(36),
ADD COLUMN     "changed_at" TIMESTAMP(3),
ADD COLUMN     "defer_reason" VARCHAR(12),
ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "lease_until" TIMESTAMP(3),
ADD COLUMN     "pushed_at" TIMESTAMP(3),
ADD COLUMN     "retry_at" TIMESTAMP(3),
ADD COLUMN     "stale_left" INTEGER,
ADD COLUMN     "stale_runs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" JSONB;

-- CreateIndex
CREATE INDEX "work_scan_status_changed_at_idx" ON "work_scan"("status", "changed_at");

ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_defer_reason_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_defer_reason_check" CHECK ("defer_reason" IS NULL OR "defer_reason" IN ('NO_CREDIT', 'BUSY', 'BLOCKED'));
ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_sorting_attempt_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_sorting_attempt_check" CHECK ("status" <> 'sorting' OR ("attempt_id" IS NOT NULL AND "lease_until" IS NOT NULL));
UPDATE "work_scan" SET "changed_at" = "completed_at" WHERE "changed_at" IS NULL AND "completed_at" IS NOT NULL;

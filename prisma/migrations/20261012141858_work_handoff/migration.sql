-- DropIndex
DROP INDEX "flow_run_signal_id_workflow_id_attempt_key";

-- AlterTable
ALTER TABLE "flow_run" ADD COLUMN     "canvas_version" INTEGER,
ADD COLUMN     "finish_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "graph_digest" VARCHAR(64),
ADD COLUMN     "handoffs" JSONB,
ADD COLUMN     "lane" VARCHAR(8) NOT NULL DEFAULT 'event',
ADD COLUMN     "next_finish_at" TIMESTAMP(3),
ADD COLUMN     "pending_skips" JSONB;

-- AlterTable
ALTER TABLE "work_signal" ALTER COLUMN "kind" SET DATA TYPE VARCHAR(20);

-- CreateTable
CREATE TABLE "work_handoff" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "to_project_id" VARCHAR(25) NOT NULL,
    "to_workflow_id" VARCHAR(25) NOT NULL,
    "from_workflow_id" VARCHAR(25) NOT NULL,
    "route_key" VARCHAR(60) NOT NULL,
    "canvas_workflow_id" VARCHAR(25) NOT NULL,
    "period_id" VARCHAR(25),
    "from_project_id" VARCHAR(25) NOT NULL,
    "from_task_id" VARCHAR(25) NOT NULL,
    "from_period_start" VARCHAR(10),
    "from_period_end" VARCHAR(10),
    "submission_number" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "inbox_row_id" VARCHAR(25),
    "in_list" BOOLEAN NOT NULL DEFAULT true,
    "flow_run_id" VARCHAR(25),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_handoff_period" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "to_project_id" VARCHAR(25) NOT NULL,
    "to_workflow_id" VARCHAR(25) NOT NULL,
    "period_start" VARCHAR(10) NOT NULL,
    "period_end" VARCHAR(10) NOT NULL,
    "expected" JSONB NOT NULL,
    "canvas_workflow_id" VARCHAR(25) NOT NULL,
    "canvas_version" INTEGER NOT NULL,
    "graph_digest" VARCHAR(64) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "opened_task_id" VARCHAR(25),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_handoff_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_handoff_to_project_id_idx" ON "work_handoff"("to_project_id");

-- CreateIndex
CREATE INDEX "work_handoff_from_task_id_idx" ON "work_handoff"("from_task_id");

-- CreateIndex
CREATE INDEX "work_handoff_from_project_id_idx" ON "work_handoff"("from_project_id");

-- CreateIndex
CREATE INDEX "work_handoff_period_id_idx" ON "work_handoff"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_handoff_period_to_project_id_period_start_period_end_key" ON "work_handoff_period"("to_project_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "flow_run_signal_id_workflow_id_lane_attempt_key" ON "flow_run"("signal_id", "workflow_id", "lane", "attempt");

-- AddForeignKey
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_to_project_id_user_id_fkey" FOREIGN KEY ("to_project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "work_handoff_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_handoff_period" ADD CONSTRAINT "work_handoff_period_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_handoff_period" ADD CONSTRAINT "work_handoff_period_to_project_id_user_id_fkey" FOREIGN KEY ("to_project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_signal" DROP CONSTRAINT IF EXISTS "work_signal_kind_check";
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_kind_check" CHECK ("kind" IN ('sealed', 'resubmitted', 'unlocked', 'inbox_row', 'task_deleted', 'project_deleted'));
ALTER TABLE "work_signal" DROP CONSTRAINT IF EXISTS "work_signal_task_check";
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_task_check" CHECK ("task_id" IS NOT NULL OR "kind" IN ('inbox_row', 'project_deleted'));

ALTER TABLE "flow_run" DROP CONSTRAINT IF EXISTS "flow_run_status_check";
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_status_check" CHECK ("status" IN ('queued', 'running', 'finishing', 'done', 'failed', 'interrupted'));
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_lane_check" CHECK ("lane" IN ('event', 'done'));
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_finish_attempts_check" CHECK ("finish_attempts" >= 0);

ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_status_check" CHECK ("status" IN ('delivered', 'skipped', 'withdrawn'));
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_submission_check" CHECK ("submission_number" >= 1);
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_period_check" CHECK (
  ("from_period_start" IS NULL) = ("from_period_end" IS NULL)
  AND ("from_period_start" IS NULL OR ("from_period_start" ~ '^\d{4}-\d{2}-\d{2}$' AND "from_period_end" ~ '^\d{4}-\d{2}-\d{2}$'))
);
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_gather_check" CHECK ("period_id" IS NULL OR "from_period_start" IS NOT NULL);
ALTER TABLE "work_handoff_period" ADD CONSTRAINT "work_handoff_period_status_check" CHECK ("status" IN ('waiting', 'opened', 'manual'));
ALTER TABLE "work_handoff_period" ADD CONSTRAINT "work_handoff_period_dates_check" CHECK ("period_start" ~ '^\d{4}-\d{2}-\d{2}$' AND "period_end" ~ '^\d{4}-\d{2}-\d{2}$' AND "period_start" <= "period_end");

CREATE UNIQUE INDEX IF NOT EXISTS "work_handoff_active_gather_key" ON "work_handoff"("route_key", "period_id", "from_period_start") WHERE "status" <> 'withdrawn' AND "period_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "work_handoff_active_pass_key" ON "work_handoff"("route_key", "from_task_id") WHERE "status" <> 'withdrawn' AND "period_id" IS NULL;

-- AlterTable
ALTER TABLE "project_reference" ADD COLUMN     "created_by_workflow_id" VARCHAR(25);

-- CreateTable
CREATE TABLE "work_signal" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "task_id" VARCHAR(25) NOT NULL,
    "app_workflow_id" VARCHAR(25),
    "kind" VARCHAR(12) NOT NULL,
    "submission_number" INTEGER,
    "period_start" VARCHAR(10),
    "period_end" VARCHAR(10),
    "payload" BYTEA NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "signal_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "event" BYTEA NOT NULL,
    "requested_by" VARCHAR(120) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "failed_node" VARCHAR(100),
    "code" VARCHAR(40),
    "blocked_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_signal_processed_at_created_at_idx" ON "work_signal"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "flow_run_status_created_at_idx" ON "flow_run"("status", "created_at");

-- CreateIndex
CREATE INDEX "flow_run_workflow_id_created_at_idx" ON "flow_run"("workflow_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "flow_run_signal_id_workflow_id_attempt_key" ON "flow_run"("signal_id", "workflow_id", "attempt");

-- AddForeignKey
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_kind_check" CHECK ("kind" IN ('sealed', 'resubmitted', 'unlocked'));
ALTER TABLE "work_signal" ADD CONSTRAINT "work_signal_period_check" CHECK (("period_start" IS NULL OR "period_start" ~ '^\d{4}-\d{2}-\d{2}$') AND ("period_end" IS NULL OR "period_end" ~ '^\d{4}-\d{2}-\d{2}$'));
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_status_check" CHECK ("status" IN ('queued', 'running', 'done', 'failed', 'interrupted'));
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_running_started_check" CHECK ("status" <> 'running' OR "started_at" IS NOT NULL);
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_attempt_check" CHECK ("attempt" >= 1);

-- AlterTable
ALTER TABLE "work_project" ADD COLUMN     "capability_off" JSONB;

-- CreateTable
CREATE TABLE "work_send" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "task_id" VARCHAR(25),
    "workflow_id" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "slot" VARCHAR(40) NOT NULL,
    "declared" VARCHAR(120),
    "status" VARCHAR(10) NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "payload" BYTEA NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "requested_by" VARCHAR(120) NOT NULL,
    "decided_by" VARCHAR(120),
    "decided_at" TIMESTAMP(3),
    "code" VARCHAR(40),
    "result" BYTEA,
    "reissue_of" VARCHAR(25),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_send_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_send_project_id_status_idx" ON "work_send"("project_id", "status");

-- CreateIndex
CREATE INDEX "work_send_status_claimed_at_idx" ON "work_send"("status", "claimed_at");

-- CreateIndex
CREATE INDEX "work_send_reissue_of_idx" ON "work_send"("reissue_of");

-- AddForeignKey
ALTER TABLE "work_send" ADD CONSTRAINT "work_send_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_send" ADD CONSTRAINT "work_send_status_check"
  CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'refused', 'discarded'));
ALTER TABLE "work_send" ADD CONSTRAINT "work_send_kind_check"
  CHECK ("kind" IN ('email', 'telegram', 'http', 'db_write', 'sms', 'call'));
ALTER TABLE "work_send" ADD CONSTRAINT "work_send_claimed_check"
  CHECK ("status" <> 'sending' OR "claimed_at" IS NOT NULL);

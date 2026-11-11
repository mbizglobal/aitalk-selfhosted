-- CreateTable
CREATE TABLE "work_canvas_trash" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "old_workflow_id" VARCHAR(25) NOT NULL,
    "body" BYTEA NOT NULL,
    "apps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_canvas_trash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_purge" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "state" VARCHAR(10) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "canvas_workflow_id" VARCHAR(25),
    "node_id" VARCHAR(100),
    "blob_regions" TEXT[],
    "deadline" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_purge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_canvas_trash_user_id_idx" ON "work_canvas_trash"("user_id");

-- CreateIndex
CREATE INDEX "work_purge_state_created_at_idx" ON "work_purge"("state", "created_at");

-- AddForeignKey
ALTER TABLE "work_canvas_trash" ADD CONSTRAINT "work_canvas_trash_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_canvas_trash" ADD CONSTRAINT "work_canvas_trash_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_purge" ADD CONSTRAINT "work_purge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_purge" ADD CONSTRAINT "work_purge_kind_check" CHECK ("kind" IN ('delete', 'upload'));
ALTER TABLE "work_purge" ADD CONSTRAINT "work_purge_state_check" CHECK ("state" IN ('pending', 'uploading', 'purging'));
ALTER TABLE "work_purge" ADD CONSTRAINT "work_purge_upload_deadline_check" CHECK ("kind" <> 'upload' OR "deadline" IS NOT NULL);

UPDATE "work_project" SET "workflow_linked_at" = "created_at" WHERE "workflow_id" IS NULL AND "workflow_linked_at" IS NULL;

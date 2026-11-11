-- CreateTable
CREATE TABLE "work_scan" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "client_scan_id" VARCHAR(64) NOT NULL,
    "form" VARCHAR(12) NOT NULL,
    "actor" VARCHAR(40) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'open',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_scan_file" (
    "scan_id" VARCHAR(25) NOT NULL,
    "file_id" VARCHAR(25) NOT NULL,
    "owner" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_scan_file_pkey" PRIMARY KEY ("scan_id","file_id")
);

-- CreateIndex
CREATE INDEX "work_scan_project_id_status_idx" ON "work_scan"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_scan_user_id_client_scan_id_key" ON "work_scan"("user_id", "client_scan_id");

-- CreateIndex
CREATE INDEX "work_scan_file_file_id_idx" ON "work_scan_file"("file_id");

-- AddForeignKey
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_scan_file" ADD CONSTRAINT "work_scan_file_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "work_scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_scan_file" ADD CONSTRAINT "work_scan_file_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "work_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_form_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_form_check" CHECK ("form" IN ('receipts', 'claims', 'statement', 'chart'));
ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_status_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_status_check" CHECK ("status" IN ('open', 'ready', 'sorting', 'done', 'deferred', 'failed', 'cancelled'));
ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_actor_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_actor_check" CHECK ("actor" = 'human' OR "actor" ~ '^member:[0-9]+$');
ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_client_scan_id_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_client_scan_id_check" CHECK (length("client_scan_id") BETWEEN 8 AND 64);
CREATE UNIQUE INDEX IF NOT EXISTS "work_scan_file_owner_one" ON "work_scan_file"("file_id") WHERE "owner";

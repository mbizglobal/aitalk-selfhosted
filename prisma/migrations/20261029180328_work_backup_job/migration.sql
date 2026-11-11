-- CreateTable
CREATE TABLE "work_backup_job" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "target_id" VARCHAR(25) NOT NULL,
    "plan" BYTEA NOT NULL,
    "part_count" INTEGER NOT NULL,
    "region" VARCHAR(40) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_backup_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_backup_job_expires_at_idx" ON "work_backup_job"("expires_at");

-- CreateIndex
CREATE INDEX "work_backup_job_user_id_idx" ON "work_backup_job"("user_id");

-- AddForeignKey
ALTER TABLE "work_backup_job" ADD CONSTRAINT "work_backup_job_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

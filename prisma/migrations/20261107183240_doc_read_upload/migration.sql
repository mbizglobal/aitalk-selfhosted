-- CreateTable
CREATE TABLE "work_file_upload" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "region" VARCHAR(30) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "pieces" SMALLINT NOT NULL,
    "payload" BYTEA NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'receiving',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_file_upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_file_upload_expires_at_idx" ON "work_file_upload"("expires_at");

-- AddForeignKey
ALTER TABLE "work_file_upload" ADD CONSTRAINT "work_file_upload_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_file_upload" ADD CONSTRAINT "work_file_upload_check" CHECK ("state" IN ('receiving', 'done') AND "size_bytes" > 0 AND "size_bytes" <= 47185920 AND "pieces" >= 1 AND "pieces" <= 6);

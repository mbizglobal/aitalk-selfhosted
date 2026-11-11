-- CreateTable
CREATE TABLE "work_counter" (
    "user_id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "work_counter_pkey" PRIMARY KEY ("user_id","name")
);

-- CreateTable
CREATE TABLE "work_public_link" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "file_id" VARCHAR(25) NOT NULL,
    "row_id" VARCHAR(25) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "last_download_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_public_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_public_link_token_hash_key" ON "work_public_link"("token_hash");

-- CreateIndex
CREATE INDEX "work_public_link_expires_at_idx" ON "work_public_link"("expires_at");

-- CreateIndex
CREATE INDEX "work_public_link_row_id_idx" ON "work_public_link"("row_id");

-- AddForeignKey
ALTER TABLE "work_counter" ADD CONSTRAINT "work_counter_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_public_link" ADD CONSTRAINT "work_public_link_file_id_project_id_user_id_fkey" FOREIGN KEY ("file_id", "project_id", "user_id") REFERENCES "work_file"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_counter" ADD CONSTRAINT "work_counter_value_check" CHECK ("value" >= 1);
ALTER TABLE "work_public_link" ADD CONSTRAINT "work_public_link_downloads_check" CHECK ("downloads" >= 0);

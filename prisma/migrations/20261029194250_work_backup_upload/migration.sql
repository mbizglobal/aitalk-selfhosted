-- CreateTable
CREATE TABLE "work_backup_upload" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'receiving',
    "region" VARCHAR(40) NOT NULL,
    "report" BYTEA,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_backup_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_backup_upload_file" (
    "upload_id" VARCHAR(25) NOT NULL,
    "file_index" INTEGER NOT NULL,
    "total_bytes" INTEGER NOT NULL,

    CONSTRAINT "work_backup_upload_file_pkey" PRIMARY KEY ("upload_id","file_index")
);

-- CreateTable
CREATE TABLE "work_backup_upload_piece" (
    "upload_id" VARCHAR(25) NOT NULL,
    "file_index" INTEGER NOT NULL,
    "offset" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_backup_upload_piece_pkey" PRIMARY KEY ("upload_id","file_index","offset")
);

-- CreateIndex
CREATE INDEX "work_backup_upload_expires_at_idx" ON "work_backup_upload"("expires_at");

-- CreateIndex
CREATE INDEX "work_backup_upload_user_id_idx" ON "work_backup_upload"("user_id");

-- AddForeignKey
ALTER TABLE "work_backup_upload" ADD CONSTRAINT "work_backup_upload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_backup_upload_file" ADD CONSTRAINT "work_backup_upload_file_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "work_backup_upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_backup_upload_piece" ADD CONSTRAINT "work_backup_upload_piece_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "work_backup_upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

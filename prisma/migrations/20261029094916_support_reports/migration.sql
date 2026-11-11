-- CreateTable
CREATE TABLE "support_reports" (
    "id" VARCHAR(25) NOT NULL,
    "number" SERIAL NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(50),
    "project_id" VARCHAR(25),
    "app_id" VARCHAR(60),
    "source" VARCHAR(20) NOT NULL,
    "reporter" VARCHAR(40) NOT NULL,
    "reporter_email" VARCHAR(320),
    "lang" VARCHAR(5) NOT NULL,
    "consent_v" SMALLINT NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "body" BYTEA,
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" VARCHAR(100),
    "reply" BYTEA,
    "reply_mail" VARCHAR(10),
    "reply_mail_at" TIMESTAMP(3),
    "purge_at" TIMESTAMP(3) NOT NULL,
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_report_files" (
    "id" VARCHAR(25) NOT NULL,
    "report_id" VARCHAR(25) NOT NULL,
    "from_file_id" VARCHAR(25),
    "meta" BYTEA NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "blob_region" VARCHAR(30) NOT NULL,
    "blob_path" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_report_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_report_accesses" (
    "id" VARCHAR(25) NOT NULL,
    "report_id" VARCHAR(25) NOT NULL,
    "file_row_id" VARCHAR(25) NOT NULL,
    "admin" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_report_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_reports_number_key" ON "support_reports"("number");

-- CreateIndex
CREATE INDEX "support_reports_user_id_created_at_idx" ON "support_reports"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "support_reports_status_created_at_idx" ON "support_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "support_reports_purged_at_purge_at_idx" ON "support_reports"("purged_at", "purge_at");

-- CreateIndex
CREATE INDEX "support_report_files_report_id_idx" ON "support_report_files"("report_id");

-- CreateIndex
CREATE INDEX "support_report_accesses_report_id_idx" ON "support_report_accesses"("report_id");

-- AddForeignKey
ALTER TABLE "support_reports" ADD CONSTRAINT "support_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_report_files" ADD CONSTRAINT "support_report_files_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "support_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

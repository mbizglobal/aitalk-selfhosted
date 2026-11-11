-- AlterTable
ALTER TABLE "work_scan" ADD COLUMN     "form_id" VARCHAR(25);

-- CreateTable
CREATE TABLE "work_form" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "sheet_id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "info" BYTEA NOT NULL,
    "shape" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "save_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "work_form_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_form_sheet_id_key" ON "work_form"("sheet_id");

-- CreateIndex
CREATE INDEX "work_form_project_id_idx" ON "work_form"("project_id");

-- CreateIndex
CREATE INDEX "work_form_user_id_created_at_idx" ON "work_form"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_form_user_id_save_key_key" ON "work_form"("user_id", "save_key");

-- AddForeignKey
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "work_form"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_form" ADD CONSTRAINT "work_form_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_form" ADD CONSTRAINT "work_form_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_form" ADD CONSTRAINT "work_form_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "data_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_form" DROP CONSTRAINT IF EXISTS "work_form_shape_check";
ALTER TABLE "work_form" ADD CONSTRAINT "work_form_shape_check" CHECK ("shape" IN ('single', 'items'));
ALTER TABLE "work_form" DROP CONSTRAINT IF EXISTS "work_form_version_check";
ALTER TABLE "work_form" ADD CONSTRAINT "work_form_version_check" CHECK ("version" >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS "work_form_name_live" ON "work_form"("project_id", lower("name")) WHERE "deleted_at" IS NULL;
ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_form_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_form_check" CHECK ("form" IN ('receipts', 'claims', 'statement', 'chart', 'myforms'));
ALTER TABLE "work_scan" DROP CONSTRAINT IF EXISTS "work_scan_form_id_check";
ALTER TABLE "work_scan" ADD CONSTRAINT "work_scan_form_id_check" CHECK ("form_id" IS NULL OR "form" = 'myforms');

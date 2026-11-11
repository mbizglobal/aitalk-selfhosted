-- AlterTable
ALTER TABLE "work_scan_file" ADD COLUMN     "hint" VARCHAR(10),
ADD COLUMN     "moved_scan_id" VARCHAR(25);

ALTER TABLE "work_scan_file" ADD CONSTRAINT "work_scan_file_hint" CHECK ("hint" IS NULL OR "hint" IN ('company', 'personal'));

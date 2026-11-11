-- AlterTable
ALTER TABLE "work_backup_job" ADD COLUMN     "error" VARCHAR(80),
ADD COLUMN     "state" VARCHAR(10) NOT NULL DEFAULT 'preparing';

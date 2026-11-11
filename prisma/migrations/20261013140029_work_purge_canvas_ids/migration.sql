-- AlterTable
ALTER TABLE "work_purge" DROP COLUMN "canvas_workflow_id",
ADD COLUMN     "canvas_workflow_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "former_parent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

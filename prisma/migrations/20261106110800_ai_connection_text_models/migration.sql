-- AlterTable
ALTER TABLE "ai_connections" ADD COLUMN     "text_models" VARCHAR(200)[] DEFAULT ARRAY[]::VARCHAR(200)[];

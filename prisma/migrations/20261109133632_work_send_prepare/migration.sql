-- AlterTable
ALTER TABLE "work_send" ADD COLUMN     "prepare_at" TIMESTAMP(3),
ADD COLUMN     "prepare_id" VARCHAR(25),
ADD COLUMN     "prepare_n" INTEGER;

-- AlterTable
ALTER TABLE "data_sheet_rows" ADD COLUMN     "f_link" VARCHAR(25);

-- CreateIndex
CREATE INDEX "idx_project_f_link" ON "data_sheet_rows"("project_id", "f_link");

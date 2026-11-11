-- DropIndex
DROP INDEX "idx_project_f_link";

CREATE INDEX IF NOT EXISTS "idx_f_link" ON "data_sheet_rows"("f_link") WHERE "f_link" IS NOT NULL;

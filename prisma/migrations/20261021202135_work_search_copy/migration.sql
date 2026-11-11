-- AlterTable
ALTER TABLE "data_sheet_rows" ADD COLUMN     "f_amt1" DECIMAL(65,30),
ADD COLUMN     "f_amt2" DECIMAL(65,30),
ADD COLUMN     "f_cur" VARCHAR(3),
ADD COLUMN     "f_date1" DATE,
ADD COLUMN     "f_date2" DATE,
ADD COLUMN     "f_date3" DATE,
ADD COLUMN     "f_date4" DATE,
ADD COLUMN     "f_key1" VARCHAR(255),
ADD COLUMN     "f_key2" VARCHAR(255),
ADD COLUMN     "f_key3" VARCHAR(255),
ADD COLUMN     "f_key4" VARCHAR(255),
ADD COLUMN     "f_party" CHAR(64),
ADD COLUMN     "f_ver" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "data_sheets" ADD COLUMN     "search_ver" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "idx_sheet_f_date1" ON "data_sheet_rows"("sheet_id", "f_date1", "id");

-- CreateIndex
CREATE INDEX "idx_sheet_f_date2" ON "data_sheet_rows"("sheet_id", "f_date2");

-- CreateIndex
CREATE INDEX "idx_sheet_f_key1" ON "data_sheet_rows"("sheet_id", "f_key1");

-- CreateIndex
CREATE INDEX "idx_sheet_f_party" ON "data_sheet_rows"("sheet_id", "f_party");

-- CreateIndex
CREATE INDEX "idx_sheet_f_ver" ON "data_sheet_rows"("sheet_id", "f_ver");

CREATE OR REPLACE FUNCTION work_change_upd_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_one(x.pid) FROM (
    SELECT DISTINCT n.project_id AS pid FROM work_change_new n JOIN work_change_old o ON o.id = n.id
    WHERE n.project_id IS NOT NULL
      AND (n.row_data, n.sealed, n.confirmed, n.confirmed_by, n.sheet_id, n.project_id, n.channel_key)
          IS DISTINCT FROM (o.row_data, o.sealed, o.confirmed, o.confirmed_by, o.sheet_id, o.project_id, o.channel_key)
    UNION
    SELECT o.project_id FROM work_change_old o JOIN work_change_new n ON n.id = o.id
    WHERE o.project_id IS NOT NULL AND o.project_id IS DISTINCT FROM n.project_id
  ) x ORDER BY x.pid;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_change_upd ON "data_sheet_rows";
CREATE TRIGGER work_change_upd AFTER UPDATE ON "data_sheet_rows" REFERENCING OLD TABLE AS work_change_old NEW TABLE AS work_change_new FOR EACH STATEMENT EXECUTE FUNCTION work_change_upd_rows();

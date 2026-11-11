-- AlterTable
ALTER TABLE "work_file" ADD COLUMN     "decision" BYTEA,
ADD COLUMN     "decision_state" VARCHAR(10);

ALTER TABLE "work_file" ADD CONSTRAINT "work_file_decision_shape" CHECK (
  (decision_state IS NULL AND decision IS NULL)
  OR (COALESCE(decision_state, '') IN ('row', 'excluded', 'pending') AND decision IS NOT NULL)
);

-- AlterTable
ALTER TABLE "work_file" ADD COLUMN     "card_claim_id" VARCHAR(40),
ADD COLUMN     "card_claim_until" TIMESTAMP(3),
ADD COLUMN     "read_card" BYTEA,
ADD COLUMN     "read_card_state" VARCHAR(10),
ADD COLUMN     "read_card_v" SMALLINT;

ALTER TABLE "work_file" ADD CONSTRAINT "work_file_read_card_shape" CHECK (
  (read_card_state IS NULL AND read_card IS NULL AND read_card_v IS NULL)
  OR (read_card_state = 'ok' AND read_card IS NOT NULL AND read_card_v IS NOT NULL)
  OR (read_card_state = 'failed' AND read_card IS NOT NULL AND read_card_v IS NULL)
);
ALTER TABLE "work_file" ADD CONSTRAINT "work_file_card_claim_pair" CHECK ((card_claim_id IS NULL) = (card_claim_until IS NULL));

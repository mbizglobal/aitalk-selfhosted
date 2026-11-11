ALTER TABLE "work_file" DROP CONSTRAINT "work_file_read_card_shape";
ALTER TABLE "work_file" ADD CONSTRAINT "work_file_read_card_shape" CHECK (
  (read_card_state IS NULL AND read_card IS NULL AND read_card_v IS NULL)
  OR (COALESCE(read_card_state, '') = 'ok' AND read_card IS NOT NULL AND read_card_v IS NOT NULL)
  OR (COALESCE(read_card_state, '') = 'failed' AND read_card IS NOT NULL AND read_card_v IS NULL)
);

-- CreateTable
CREATE TABLE "work_file_page_block" (
    "id" VARCHAR(25) NOT NULL,
    "file_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "block_no" SMALLINT NOT NULL,
    "total_pages" SMALLINT NOT NULL,
    "pages" BYTEA NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'partial',
    "charged" BOOLEAN NOT NULL DEFAULT false,
    "claim_id" VARCHAR(40),
    "claim_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_file_page_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_doc_find_block" (
    "id" VARCHAR(25) NOT NULL,
    "file_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "fields_hash" CHAR(64) NOT NULL,
    "block_no" SMALLINT NOT NULL,
    "result" BYTEA,
    "state" VARCHAR(10) NOT NULL DEFAULT 'open',
    "charged" BOOLEAN NOT NULL DEFAULT false,
    "claim_id" VARCHAR(40),
    "claim_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_doc_find_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_file_page_block_project_id_idx" ON "work_file_page_block"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_file_page_block_file_id_block_no_key" ON "work_file_page_block"("file_id", "block_no");

-- CreateIndex
CREATE INDEX "work_doc_find_block_project_id_idx" ON "work_doc_find_block"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_doc_find_block_file_id_fields_hash_block_no_key" ON "work_doc_find_block"("file_id", "fields_hash", "block_no");

-- AddForeignKey
ALTER TABLE "work_file_page_block" ADD CONSTRAINT "work_file_page_block_file_id_project_id_user_id_fkey" FOREIGN KEY ("file_id", "project_id", "user_id") REFERENCES "work_file"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_doc_find_block" ADD CONSTRAINT "work_doc_find_block_file_id_project_id_user_id_fkey" FOREIGN KEY ("file_id", "project_id", "user_id") REFERENCES "work_file"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_file_page_block" ADD CONSTRAINT "work_file_page_block_state_check" CHECK ("state" IN ('partial', 'done'));
ALTER TABLE "work_file_page_block" ADD CONSTRAINT "work_file_page_block_no_check" CHECK ("block_no" >= 0 AND "total_pages" >= 1 AND "block_no" * 10 < "total_pages");
ALTER TABLE "work_doc_find_block" ADD CONSTRAINT "work_doc_find_block_state_check" CHECK ("state" IN ('open', 'done'));
ALTER TABLE "work_doc_find_block" ADD CONSTRAINT "work_doc_find_block_no_check" CHECK ("block_no" >= 0);

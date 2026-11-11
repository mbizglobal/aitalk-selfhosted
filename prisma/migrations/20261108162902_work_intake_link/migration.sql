-- CreateTable
CREATE TABLE "work_intake_link" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "table_key" VARCHAR(40) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_sealed" BYTEA NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_intake_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_intake_link_token_hash_key" ON "work_intake_link"("token_hash");

-- CreateIndex
CREATE INDEX "work_intake_link_project_id_table_key_idx" ON "work_intake_link"("project_id", "table_key");

-- AddForeignKey
ALTER TABLE "work_intake_link" ADD CONSTRAINT "work_intake_link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_intake_link" ADD CONSTRAINT "work_intake_link_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

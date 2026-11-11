-- CreateTable
CREATE TABLE "work_webhook_hook" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "table_key" VARCHAR(40) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_sealed" BYTEA NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_webhook_hook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_webhook_receipt" (
    "id" VARCHAR(25) NOT NULL,
    "hook_id" VARCHAR(25) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "row_id" VARCHAR(25) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_webhook_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_webhook_hook_token_hash_key" ON "work_webhook_hook"("token_hash");

-- CreateIndex
CREATE INDEX "work_webhook_hook_project_id_table_key_idx" ON "work_webhook_hook"("project_id", "table_key");

-- CreateIndex
CREATE UNIQUE INDEX "work_webhook_receipt_hook_id_key_hash_key" ON "work_webhook_receipt"("hook_id", "key_hash");

-- AddForeignKey
ALTER TABLE "work_webhook_hook" ADD CONSTRAINT "work_webhook_hook_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_webhook_hook" ADD CONSTRAINT "work_webhook_hook_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_webhook_receipt" ADD CONSTRAINT "work_webhook_receipt_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "work_webhook_hook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

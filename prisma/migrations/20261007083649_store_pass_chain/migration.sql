-- AlterTable
ALTER TABLE "store_transactions" ADD COLUMN     "chain_root" VARCHAR(512);

-- CreateIndex
CREATE INDEX "store_transactions_user_id_chain_root_idx" ON "store_transactions"("user_id", "chain_root");

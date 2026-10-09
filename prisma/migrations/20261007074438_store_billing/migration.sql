-- CreateEnum
CREATE TYPE "StoreTransactionKind" AS ENUM ('subscription', 'pass');

-- CreateEnum
CREATE TYPE "StoreTransactionOutcome" AS ENUM ('granted', 'refused_double', 'refused_ineligible', 'ignored');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentPlatform" ADD VALUE 'google_play';
ALTER TYPE "PaymentPlatform" ADD VALUE 'app_store';

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN     "store_account_key" VARCHAR(64),
ADD COLUMN     "store_purchase_token" VARCHAR(512);

-- CreateTable
CREATE TABLE "store_transactions" (
    "id" VARCHAR(25) NOT NULL,
    "store" "PaymentPlatform" NOT NULL,
    "kind" "StoreTransactionKind" NOT NULL,
    "order_id" VARCHAR(100) NOT NULL,
    "purchase_token" VARCHAR(512) NOT NULL,
    "linked_token" VARCHAR(512),
    "product_id" VARCHAR(100) NOT NULL,
    "expiry_time" TIMESTAMP(3),
    "user_id" VARCHAR(25) NOT NULL,
    "outcome" "StoreTransactionOutcome" NOT NULL,
    "refunded_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_transactions_purchase_token_idx" ON "store_transactions"("purchase_token");

-- CreateIndex
CREATE INDEX "store_transactions_linked_token_idx" ON "store_transactions"("linked_token");

-- CreateIndex
CREATE INDEX "store_transactions_user_id_kind_created_at_idx" ON "store_transactions"("user_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_transactions_store_order_id_key" ON "store_transactions"("store", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_store_purchase_token_key" ON "subscription"("store_purchase_token");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_store_account_key_key" ON "subscription"("store_account_key");

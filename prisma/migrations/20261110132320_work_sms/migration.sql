-- AlterTable
ALTER TABLE "managed_region_config" ADD COLUMN     "infobip_api_key" TEXT,
ADD COLUMN     "infobip_base_url" VARCHAR(200),
ADD COLUMN     "infobip_sender" VARCHAR(20);

-- AlterTable
ALTER TABLE "work_send" ADD COLUMN     "dispatched_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "work_sms_charges" (
    "send_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "credits" INTEGER NOT NULL,
    "free_charged" INTEGER NOT NULL,
    "booster_charged" INTEGER NOT NULL,
    "paid_charged" INTEGER NOT NULL,
    "log_date" DATE NOT NULL,
    "booster_expires_at" TIMESTAMP(3),
    "status" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "work_sms_charges_pkey" PRIMARY KEY ("send_id")
);

-- CreateIndex
CREATE INDEX "work_sms_charges_user_id_idx" ON "work_sms_charges"("user_id");

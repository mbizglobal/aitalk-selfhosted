-- AlterTable
ALTER TABLE "work_message" ADD COLUMN     "owner" VARCHAR(40),
ADD COLUMN     "purge_at" TIMESTAMP(3),
ADD COLUMN     "room" VARCHAR(8) NOT NULL DEFAULT 'team';

-- CreateTable
CREATE TABLE "work_room_read" (
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "task_key" VARCHAR(25) NOT NULL,
    "reader" VARCHAR(40) NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_room_read_pkey" PRIMARY KEY ("project_id","task_key","reader")
);

-- CreateIndex
CREATE INDEX "work_message_project_id_task_id_room_owner_created_at_idx" ON "work_message"("project_id", "task_id", "room", "owner", "created_at");

-- CreateIndex
CREATE INDEX "work_message_purge_at_idx" ON "work_message"("purge_at");

-- AddForeignKey
ALTER TABLE "work_room_read" ADD CONSTRAINT "work_room_read_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_message" ADD CONSTRAINT "work_message_room_owner_check" CHECK (("room" = 'team' AND "owner" IS NULL) OR ("room" = 'private' AND "owner" IS NOT NULL));

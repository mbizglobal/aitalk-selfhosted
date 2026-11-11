-- CreateTable
CREATE TABLE "work_alert_fired" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "row_id" VARCHAR(25) NOT NULL,
    "table_key" VARCHAR(40) NOT NULL,
    "alert_key" VARCHAR(40) NOT NULL,
    "target_date" VARCHAR(10) NOT NULL,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "send_id" VARCHAR(25),
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_alert_fired_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_alert_fired_project_id_idx" ON "work_alert_fired"("project_id");

-- CreateIndex
CREATE INDEX "work_alert_fired_user_id_idx" ON "work_alert_fired"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_alert_fired_row_id_table_key_alert_key_key" ON "work_alert_fired"("row_id", "table_key", "alert_key");

-- AddForeignKey
ALTER TABLE "work_alert_fired" ADD CONSTRAINT "work_alert_fired_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_alert_fired" ADD CONSTRAINT "work_alert_fired_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_alert_fired" ADD CONSTRAINT "work_alert_fired_row_id_project_id_user_id_fkey" FOREIGN KEY ("row_id", "project_id", "user_id") REFERENCES "data_sheet_rows"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

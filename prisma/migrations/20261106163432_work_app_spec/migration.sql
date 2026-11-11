-- CreateTable
CREATE TABLE "work_app_spec" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "info" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_app_spec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_app_spec_project_id_key" ON "work_app_spec"("project_id");

-- CreateIndex
CREATE INDEX "work_app_spec_user_id_idx" ON "work_app_spec"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_app_spec_project_id_user_id_key" ON "work_app_spec"("project_id", "user_id");

-- AddForeignKey
ALTER TABLE "work_app_spec" ADD CONSTRAINT "work_app_spec_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_app_spec" ADD CONSTRAINT "work_app_spec_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

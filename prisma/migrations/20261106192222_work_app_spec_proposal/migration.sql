-- CreateTable
CREATE TABLE "work_app_spec_proposal" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "token_id" VARCHAR(25) NOT NULL,
    "base_version" INTEGER NOT NULL,
    "info" BYTEA NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_app_spec_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_app_spec_proposal_project_id_idx" ON "work_app_spec_proposal"("project_id");

-- CreateIndex
CREATE INDEX "work_app_spec_proposal_user_id_idx" ON "work_app_spec_proposal"("user_id");

-- AddForeignKey
ALTER TABLE "work_app_spec_proposal" ADD CONSTRAINT "work_app_spec_proposal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_app_spec_proposal" ADD CONSTRAINT "work_app_spec_proposal_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

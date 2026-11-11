-- AlterTable
ALTER TABLE "agent_member_invitations" ADD COLUMN     "access_all" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "access_workflow_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "agent_members" ADD COLUMN     "access_all" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "agent_member_access" (
    "member_id" INTEGER NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_member_access_pkey" PRIMARY KEY ("member_id","workflow_id")
);

-- CreateIndex
CREATE INDEX "agent_member_access_workflow_id_idx" ON "agent_member_access"("workflow_id");

-- AddForeignKey
ALTER TABLE "agent_member_access" ADD CONSTRAINT "agent_member_access_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "agent_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_member_access" ADD CONSTRAINT "agent_member_access_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

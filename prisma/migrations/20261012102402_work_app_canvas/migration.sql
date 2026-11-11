-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "app_project_id" VARCHAR(25),
ADD COLUMN     "parent_node_id" VARCHAR(100),
ADD COLUMN     "parent_workflow_id" VARCHAR(25);

-- CreateIndex
CREATE UNIQUE INDEX "workflows_parent_workflow_id_parent_node_id_key" ON "workflows"("parent_workflow_id", "parent_node_id");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_parent_workflow_id_fkey" FOREIGN KEY ("parent_workflow_id") REFERENCES "workflows"("workflowId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflows" ADD CONSTRAINT "workflows_app_parent_check" CHECK (
  (kind = 'app' AND parent_node_id IS NOT NULL)
  OR (kind <> 'app' AND parent_workflow_id IS NULL AND parent_node_id IS NULL AND app_project_id IS NULL)
);

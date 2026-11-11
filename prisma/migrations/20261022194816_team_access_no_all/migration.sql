-- AlterTable
ALTER TABLE "agent_member_invitations" ALTER COLUMN "access_all" SET DEFAULT false;

-- AlterTable
ALTER TABLE "agent_members" ALTER COLUMN "access_all" SET DEFAULT false;

INSERT INTO "agent_member_access" ("member_id", "workflow_id")
SELECT m."id", w."workflowId" FROM "agent_members" m JOIN "workflows" w ON w."agentId" = m."agent_id"
WHERE m."access_all" = true
ON CONFLICT DO NOTHING;
UPDATE "agent_members" SET "access_all" = false WHERE "access_all" = true;
UPDATE "agent_member_invitations" i
SET "access_workflow_ids" = COALESCE((SELECT array_agg(w."workflowId" ORDER BY w."workflowId") FROM "workflows" w WHERE w."agentId" = i."agent_id"), '{}'), "access_all" = false
WHERE i."access_all" = true;

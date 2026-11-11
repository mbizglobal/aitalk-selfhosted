
DELETE FROM flow_run r
WHERE NOT EXISTS (SELECT 1 FROM workflows w WHERE w."workflowId" = r.workflow_id);

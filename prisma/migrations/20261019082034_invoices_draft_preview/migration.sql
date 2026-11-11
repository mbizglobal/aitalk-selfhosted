
UPDATE work_project
SET modules = array_append(modules, 'invoices.draft-preview')
WHERE kind = 'invoices'
  AND NOT ('invoices.draft-preview' = ANY(modules));

UPDATE work_project
SET modules = array_append(modules, 'swiss-acc.invoice.draft-preview')
WHERE kind = 'swiss-acc-invoice'
  AND NOT ('swiss-acc.invoice.draft-preview' = ANY(modules));

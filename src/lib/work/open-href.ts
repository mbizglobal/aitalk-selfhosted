export function workAppOpenHref(a: { agentId: string | null; state: string; appWorkflowId: string | null; projectId: string }, lang: string): string | null {
  if (!a.agentId) return null
  const base = `/chat/${encodeURIComponent(a.agentId)}/app?`
  return a.state === 'live' && a.appWorkflowId
    ? `${base}workflowId=${encodeURIComponent(a.appWorkflowId)}&lang=${lang}`
    : `${base}project=${encodeURIComponent(a.projectId)}&lang=${lang}`
}

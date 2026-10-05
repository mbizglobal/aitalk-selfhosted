
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (error) {
    console.error('Failed to copy to clipboard:', error)
    return false
  }
}

export function getEmbedCode(agentId: string | null, workflowId?: string | null): string {
  if (!agentId) return ''
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const workflowIdAttr = workflowId
    ? `\n    script.setAttribute('data-workflow-id', '${workflowId}');`
    : ''

  return `<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${baseUrl}/embed.min.js';
    script.setAttribute('data-agent-id', '${agentId}');
    script.setAttribute('data-base-url', '${baseUrl}');${workflowIdAttr}
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`
}
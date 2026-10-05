'use client'

import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Edit,
  Copy,
  Settings,
  Wand2,
  ImageIcon,
  MessageCircle,
  Shield,
  MousePointerClick,
  ExternalLink,
} from 'lucide-react'
import type { Workflow, Agent } from '../types'
import { getStartNodeFromWorkflow } from '../utils'

interface WidgetSettingsDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  workflow: Workflow | null
  agent: Agent
  t: Record<string, string>
}

export function WidgetSettingsDialog({
  isOpen,
  onOpenChange,
  workflow,
  agent,
  t,
}: WidgetSettingsDialogProps) {
  const router = useRouter()

  if (!workflow) return null

  const startNode = getStartNodeFromWorkflow(workflow)

  if (!startNode) {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[1400px] w-[90vw] max-h-[90vh] p-0">
          <div className="overflow-y-auto overflow-x-hidden max-h-[90vh] pl-8 pr-8">
            <DialogHeader className="pt-6">
              <DialogTitle>{t.widget_settings_title}</DialogTitle>
              <DialogDescription>
                {t.widget_settings_description.replace('{name}', workflow.name)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 bg-yellow-500/10 rounded-full mb-4">
                  <Settings className="w-8 h-8 text-yellow-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{t.widget_start_node_missing}</h3>
                <p className="text-muted-foreground mb-4 max-w-md">
                  {t.widget_start_node_missing_desc}
                </p>
                <Button
                  onClick={() => {
                    onOpenChange(false)
                    router.push(`/app/agent-studio?workflowId=${workflow.workflowId}`)
                  }}
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {t.widget_go_to_studio}
                </Button>
              </div>
            </div>

            <DialogFooter className="py-6">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const accessMode = (startNode?.data?.accessMode || agent.accessMode || 'public') as 'public' | 'team'
  const workflowId = workflow.workflowId
  const agentId = agent.agentId
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const urlSuffix = workflowId ? `?workflowId=${workflowId}` : ''

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1400px] w-[90vw] max-h-[90vh] p-0">
        <div className="overflow-y-auto overflow-x-hidden max-h-[90vh] pl-8 pr-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-600">
          <DialogHeader className="pt-6">
            <DialogTitle>{t.widget_settings_title}</DialogTitle>
            <DialogDescription>
              {t.widget_settings_description.replace('{name}', workflow.name)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Widget Type */}
            <div>
              <label className="text-sm font-medium mb-2 block">Widget Type</label>
              <div className="p-3 bg-muted rounded-md">
                <span className="text-sm font-medium">
                  {accessMode === 'public' ? 'Public Service' : 'Team Member'}
                </span>
              </div>
            </div>

            {/* Chat Settings (only for Public) */}
            {accessMode === 'public' && (
              <div className="pt-4 border-t">
                <label className="text-sm font-medium mb-3 block">Chat Settings</label>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-9"
                    onClick={() => window.open('/app/chat-settings?tab=general', '_blank')}
                  >
                    <Wand2 className="w-4 h-4 mr-2" />
                    General
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-9"
                    onClick={() => window.open('/app/chat-settings?tab=icons', '_blank')}
                  >
                    <ImageIcon className="w-4 h-4 mr-2" />
                    Icons
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-9"
                    onClick={() => window.open('/app/chat-settings?tab=experience', '_blank')}
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Experience
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-9"
                    onClick={() => window.open('/app/chat-settings?tab=privacy', '_blank')}
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Privacy
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-9"
                    onClick={() => window.open('/app/chat-settings?tab=chat-button', '_blank')}
                  >
                    <MousePointerClick className="w-4 h-4 mr-2" />
                    Chat Button
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </Button>
                </div>
              </div>
            )}

            {/* Widget Integration */}
            <div className="pt-4 border-t">
              <label className="text-sm font-medium mb-3 block">Widget Integration</label>

              {accessMode === 'public' && (
                <>
                  <div className="mb-4">
                    <label className="text-xs text-muted-foreground mb-1 block">Preview URL</label>
                    <div className="flex gap-3">
                      <Input
                        value={`${origin}/chat/${agentId}/preview${urlSuffix}`}
                        readOnly
                        onFocus={(e) => e.target.blur()}
                        className="font-mono text-xs flex-1 max-w-[900px]"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => navigator.clipboard.writeText(`${origin}/chat/${agentId}/preview${urlSuffix}`)}
                      >
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => window.open(`/chat/${agentId}/preview${urlSuffix}`, '_blank')}
                      >
                        Open
                      </Button>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="text-xs text-muted-foreground mb-1 block">Full Screen URL</label>
                    <div className="flex gap-3">
                      <Input
                        value={`${origin}/chat/${agentId}${urlSuffix}`}
                        readOnly
                        onFocus={(e) => e.target.blur()}
                        className="font-mono text-xs flex-1 max-w-[900px]"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => navigator.clipboard.writeText(`${origin}/chat/${agentId}${urlSuffix}`)}
                      >
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => window.open(`/chat/${agentId}${urlSuffix}`, '_blank')}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {accessMode === 'team' && (
                <div className="mb-4">
                  <label className="text-xs text-muted-foreground mb-1 block">Service URL (Team)</label>
                  <div className="flex gap-3">
                    <Input
                      value={`${origin}/chat/${agentId}/team${urlSuffix}`}
                      readOnly
                      onFocus={(e) => e.target.blur()}
                      className="font-mono text-xs flex-1 max-w-[900px]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => navigator.clipboard.writeText(`${origin}/chat/${agentId}/team${urlSuffix}`)}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => window.open(`/chat/${agentId}/team${urlSuffix}`, '_blank')}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              )}

              {accessMode === 'public' && (
                <>
                  <div className="mb-4">
                    <label className="text-xs text-muted-foreground mb-1 block">iFrame Code</label>
                    <Textarea
                      value={`<iframe src="${origin}/chat/${agentId}${urlSuffix}" width="400" height="700" frameborder="0"></iframe>`}
                      readOnly
                      className="font-mono text-xs min-h-[80px]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => navigator.clipboard.writeText(`<iframe src="${origin}/chat/${agentId}${urlSuffix}" width="400" height="700" frameborder="0"></iframe>`)}
                    >
                      <Copy className="w-3 h-3 mr-2" />
                      Copy to Clipboard
                    </Button>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">JavaScript Embed</label>
                    <Textarea
                      value={`<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${origin}/embed.min.js';
    script.setAttribute('data-agent-id', '${agentId}');
    script.setAttribute('data-base-url', '${origin}');${workflowId ? `\n    script.setAttribute('data-workflow-id', '${workflowId}');` : ''}
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`}
                      readOnly
                      className="font-mono text-xs min-h-[150px]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => navigator.clipboard.writeText(`<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${origin}/embed.min.js';
    script.setAttribute('data-agent-id', '${agentId}');
    script.setAttribute('data-base-url', '${origin}');${workflowId ? `\n    script.setAttribute('data-workflow-id', '${workflowId}');` : ''}
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`)}
                    >
                      <Copy className="w-3 h-3 mr-2" />
                      Copy to Clipboard
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter className="py-6">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

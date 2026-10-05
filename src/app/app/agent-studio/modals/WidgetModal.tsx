'use client'

import React from 'react'
import { X, Copy, ExternalLink, GripHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { copyToClipboard, getEmbedCode } from '../utils'
import { useDraggable } from '../hooks/useDraggable'

export function WidgetModal() {
  const { ui, agent, workflow } = useWorkflowContext()
  const mode = ui.showWidgetModal

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: !!mode })

  if (!mode) return null

  const agentId = agent.agentId
  const workflowId = agent.workflowId

  const startNode = workflow.nodes.find(n => n.data?.nodeType === 'start')
  const accessMode = (startNode?.data.accessMode || agent.accessMode || 'public') as 'public' | 'team'

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const urlSuffix = workflowId ? `?workflowId=${workflowId}` : ''

  const handleCopy = async (value: string, field: string) => {
    if (!value) return
    const success = await copyToClipboard(value)
    if (success) {
      ui.setCopiedField(field)
      setTimeout(() => ui.setCopiedField(null), 1500)
    }
  }

  const handleOpen = (path: string) => {
    if (typeof window === 'undefined') return
    window.open(path, '_blank')
  }

  const closeModal = () => ui.setShowWidgetModal(null)

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-3xl w-full max-h-[80vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-200">
              {mode === 'url' && 'Chat Widget URL'}
              {mode === 'iframe' && 'iFrame Code'}
              {mode === 'embed' && 'JavaScript Embed Code'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto scrollbar-thin">
          {mode === 'url' && (
            <div className="space-y-6">
              {accessMode === 'public' ? (
              <>
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-200">
                    Preview URL
                  </p>
                  <p className="text-xs text-gray-400">
                    Use this URL to preview your chat widget in a browser.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={agentId ? `${origin}/chat/${agentId}/preview${urlSuffix}` : 'Create agent first'}
                      readOnly
                      className="font-mono text-sm bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 flex-1"
                    />
                    {agentId && (
                      <>
                        <Button
                          variant="outline"
                          className="border-[#3A3A3A] hover:bg-[#3A3A3A] text-gray-200 bg-transparent"
                          onClick={() => handleCopy(`${origin}/chat/${agentId}/preview${urlSuffix}`, 'widget-url')}
                        >
                          {ui.copiedField === 'widget-url' ? '✓ Copied' : <><Copy className="h-4 w-4 mr-2" /> Copy</>}
                        </Button>
                        <Button
                          variant="outline"
                          className="border-[#3A3A3A] hover:bg-[#3A3A3A] text-gray-200 bg-transparent"
                          onClick={() => handleOpen(`/chat/${agentId}/preview${urlSuffix}`)}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-[#3A3A3A]">
                  <p className="text-sm font-medium text-gray-200">
                    Full Screen URL
                  </p>
                  <p className="text-xs text-gray-400">
                    Use this URL for a full-screen chat experience.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={agentId ? `${origin}/chat/${agentId}${urlSuffix}` : 'Create agent first'}
                      readOnly
                      className="font-mono text-sm bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 flex-1"
                    />
                    {agentId && (
                      <>
                        <Button
                          variant="outline"
                          className="border-[#3A3A3A] hover:bg-[#3A3A3A] text-gray-200 bg-transparent"
                          onClick={() => handleCopy(`${origin}/chat/${agentId}${urlSuffix}`, 'fullscreen-url')}
                        >
                          {ui.copiedField === 'fullscreen-url' ? '✓ Copied' : <><Copy className="h-4 w-4 mr-2" /> Copy</>}
                        </Button>
                        <Button
                          variant="outline"
                          className="border-[#3A3A3A] hover:bg-[#3A3A3A] text-gray-200 bg-transparent"
                          onClick={() => handleOpen(`/chat/${agentId}${urlSuffix}`)}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </>
              ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-200">
                  Service URL
                </p>
                <p className="text-xs text-gray-400">
                  Use this URL for team member chat access.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={agentId ? `${origin}/chat/${agentId}/team${urlSuffix}` : 'Create agent first'}
                    readOnly
                    className="font-mono text-sm bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 flex-1"
                  />
                  {agentId && (
                    <>
                      <Button
                        variant="outline"
                        className="border-[#3A3A3A] hover:bg-[#3A3A3A] text-gray-200 bg-transparent"
                        onClick={() => handleCopy(`${origin}/chat/${agentId}/team${urlSuffix}`, 'team-url')}
                      >
                        {ui.copiedField === 'team-url' ? '✓ Copied' : <><Copy className="h-4 w-4 mr-2" /> Copy</>}
                      </Button>
                      <Button
                        variant="outline"
                        className="border-[#3A3A3A] hover:bg-[#3A3A3A] text-gray-200 bg-transparent"
                        onClick={() => handleOpen(`/chat/${agentId}/team${urlSuffix}`)}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open
                      </Button>
                    </>
                  )}
                </div>
              </div>
              )}
            </div>
          )}

          {mode === 'iframe' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
              Copy and paste this iFrame code into your website's HTML.
              </p>
              <Textarea
              value={agentId ? `<iframe src="${origin}/chat/${agentId}${urlSuffix}" width="400" height="700" frameborder="0"></iframe>` : 'Create agent first'}
              readOnly
              className="font-mono text-sm min-h-[120px] bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 resize-none"
              />
              {agentId && (
              <Button
                className="w-full"
                onClick={() =>
                  handleCopy(
                    `<iframe src="${origin}/chat/${agentId}${urlSuffix}" width="400" height="700" frameborder="0"></iframe>`,
                    'iframe'
                  )
                }
              >
                {ui.copiedField === 'iframe' ? '✓ Copied to Clipboard' : <><Copy className="h-4 w-4 mr-2" /> Copy to Clipboard</>}
              </Button>
              )}
            </div>
          )}

          {mode === 'embed' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
              Paste this JavaScript code in your website's HTML to embed the chat widget. This is the recommended method.
              </p>
              <Textarea
              value={agentId ? getEmbedCode(agentId, workflowId) : 'Create agent first'}
              readOnly
              className="font-mono text-sm min-h-[200px] bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 resize-none"
              />
              {agentId && (
              <Button
                className="w-full"
                onClick={() => handleCopy(getEmbedCode(agentId, workflowId), 'embed')}
              >
                {ui.copiedField === 'embed' ? '✓ Copied to Clipboard' : <><Copy className="h-4 w-4 mr-2" /> Copy to Clipboard</>}
              </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

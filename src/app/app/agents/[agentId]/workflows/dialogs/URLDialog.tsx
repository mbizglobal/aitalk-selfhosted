'use client'

import { useEdition } from '@/components/EditionProvider'
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Copy, Check, ExternalLink, AlertCircle, QrCode, Link, Code, FileCode, Phone } from 'lucide-react'
import type { Workflow } from '../types'
import { generateWebVoiceEmbedCode, buildWebVoicePopupUrl, type WebVoiceConfig } from '@/lib/webVoiceEmbed'

interface URLDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  workflow: Workflow | null
  agentId: string
  accessMode: 'public' | 'team'
  t: Record<string, string>
}

type TriggerType = 'chatWidget' | 'schedule' | 'telegram' | 'pstn' | null

export function URLDialog({
  isOpen,
  onOpenChange,
  workflow,
  agentId,
  accessMode,
  t,
}: URLDialogProps) {
  const [showQR, setShowQR] = useState(false)
  const [activeTab, setActiveTab] = useState<'url' | 'iframe' | 'js'>('url')
  const [copiedEmbed, setCopiedEmbed] = useState(false)

  const getStartNodeSettings = (): {
    triggerType: TriggerType
    widgetType: 'public' | 'team'
    webVoice: WebVoiceConfig | null
  } => {
    if (!workflow?.workflowJson) return { triggerType: 'chatWidget', widgetType: 'public', webVoice: null }
    try {
      const workflowData = typeof workflow.workflowJson === 'string'
        ? JSON.parse(workflow.workflowJson)
        : workflow.workflowJson

      const startNode = workflowData.nodes?.find((node: any) =>
        node.type === 'start' || node.data?.nodeType === 'start' || node.id?.startsWith('start')
      )

      return {
        triggerType: startNode?.data?.triggerType || 'chatWidget',
        widgetType: startNode?.data?.accessMode || startNode?.data?.widgetType || 'public',
        webVoice: (startNode?.data?.webVoice as WebVoiceConfig | undefined) ?? null,
      }
    } catch {
      return { triggerType: 'chatWidget', widgetType: 'public', webVoice: null }
    }
  }

  const { triggerType, widgetType, webVoice } = getStartNodeSettings()
  const isPstn = triggerType === 'pstn'
  const isWebVoiceEnabled = isPstn && !!webVoice?.enabled
  const hasURL = triggerType === 'chatWidget'

  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://www.aitalk.ch'

  const urlSuffixChat = workflow?.workflowId ? `?workflowId=${workflow.workflowId}` : ''
  const fullScreenUrl = `${baseUrl}/chat/${agentId}${urlSuffixChat}`
  const previewUrl = `${baseUrl}/chat/${agentId}/preview${urlSuffixChat}`
  const teamUrl = `${baseUrl}/chat/${agentId}/team${urlSuffixChat}`
  const displayUrl = widgetType === 'team' ? teamUrl : fullScreenUrl
  const effectiveAccessMode = widgetType === 'team' ? 'team' : 'public'

  const selfHosted = useEdition() === 'selfhosted'
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(displayUrl)}`

  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copyUrl = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const openInNewTab = (url: string) => {
    window.open(url, '_blank')
  }

  const workflowId = workflow?.workflowId
  const urlSuffix = workflowId ? `?workflowId=${workflowId}` : ''
  const iframeCode = `<iframe src="${baseUrl}/chat/${agentId}${urlSuffix}" width="400" height="700" frameborder="0"></iframe>`
  const jsCode = `<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${baseUrl}/embed.min.js';
    script.setAttribute('data-agent-id', '${agentId}');
    script.setAttribute('data-base-url', '${baseUrl}');${workflowId ? `\n    script.setAttribute('data-workflow-id', '${workflowId}');` : ''}
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`

  const handleCopyEmbed = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedEmbed(true)
      setTimeout(() => setCopiedEmbed(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Web Voice (PSTN) — popup URL + embed HTML
  const voicePopupUrl = isPstn && workflow?.workflowId
    ? buildWebVoicePopupUrl(baseUrl, agentId, workflow.workflowId)
    : ''
  const voiceEmbedCode = isWebVoiceEnabled && workflow?.workflowId
    ? generateWebVoiceEmbedCode(agentId, workflow.workflowId, webVoice as WebVoiceConfig, baseUrl)
    : ''

  const handleOpenVoicePopup = () => {
    window.open(voicePopupUrl, 'aitalk-voice', 'width=420,height=680,scrollbars=no')
  }

  useEffect(() => {
    if (!isOpen) {
      setCopiedKey(null)
      setShowQR(false)
      setActiveTab('url')
      setCopiedEmbed(false)
    }
  }, [isOpen])

  const getNoURLMessage = () => {
    switch (triggerType) {
      case 'schedule':
        return t.workflow_url_no_url_schedule || 'This workflow is triggered by a schedule and does not have a public URL.'
      case 'telegram':
        return t.workflow_url_no_url_telegram || 'This workflow is triggered by Telegram and does not have a public URL.'
      case 'pstn':
        return t.workflow_url_pstn_web_voice_disabled
          || 'This workflow is triggered by a phone call. Enable Web Voice in the PSTN node\'s Advanced Settings to get an embeddable browser-call button.'
      default:
        return t.workflow_url_no_url_default || 'This workflow does not have a public URL.'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasURL ? (
              <ExternalLink className="w-5 h-5" />
            ) : isWebVoiceEnabled ? (
              <Phone className="w-5 h-5 text-teal-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-yellow-500" />
            )}
            {workflow?.name} - URL
          </DialogTitle>
          <DialogDescription>
            {hasURL
              ? (effectiveAccessMode === 'public'
                  ? (t.workflow_url_public_desc || 'Public URL for this workflow')
                  : (t.workflow_url_team_desc || 'Team URL for this workflow'))
              : isWebVoiceEnabled
                ? (t.workflow_url_pstn_web_voice_desc || 'Web Voice button — embed on your website to start browser voice calls.')
                : (t.workflow_url_no_url_title || 'No URL Available')
            }
          </DialogDescription>
        </DialogHeader>

        {isWebVoiceEnabled ? (
          <div className="space-y-4">
            {/* Popup URL */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                {t.workflow_url_pstn_voice_url_label || 'Web Voice Test URL'}
              </label>
              <div className="p-3 bg-muted rounded-md font-mono text-xs break-all select-all">
                {voicePopupUrl}
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" className="flex-1" onClick={() => copyUrl(voicePopupUrl, 'voice')}>
                  {copiedKey === 'voice' ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copiedKey === 'voice' ? (t.copied || 'Copied!') : (t.copy || 'Copy')}
                </Button>
                <Button variant="outline" className="flex-1" onClick={handleOpenVoicePopup}>
                  <Phone className="w-4 h-4 mr-2" />
                  {t.workflow_url_pstn_voice_open || 'Open Voice Call'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t.workflow_url_pstn_voice_url_hint || 'Open this URL in a browser to start a test voice call.'}
              </p>
            </div>

            {/* Embed Code */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                {t.workflow_url_pstn_embed_label || 'Embed Code'}
              </label>
              <pre className="p-3 bg-muted rounded-md font-mono text-xs whitespace-pre-wrap break-all max-h-[260px] overflow-y-auto scrollbar-thin select-all">
                {voiceEmbedCode}
              </pre>
              <Button variant="outline" className="w-full mt-2" onClick={() => handleCopyEmbed(voiceEmbedCode)}>
                {copiedEmbed ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                {copiedEmbed ? (t.copied || 'Copied!') : 'Copy to Clipboard'}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                {t.workflow_url_pstn_embed_hint || 'Paste this HTML anywhere on your website. The button opens a popup for browser voice calls. Customize colors and styles in the PSTN node\'s Advanced Settings → Web Voice.'}
              </p>
            </div>
          </div>
        ) : hasURL ? (
          <div className="space-y-4">
            {effectiveAccessMode === 'public' ? (
              <>
                <div className="flex gap-2">
                  <Button
                    variant={activeTab === 'url' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setActiveTab('url')}
                  >
                    <Link className="w-3 h-3 mr-1.5" />
                    Chat Widget URL
                  </Button>
                  <Button
                    variant={activeTab === 'iframe' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setActiveTab('iframe')}
                  >
                    <Code className="w-3 h-3 mr-1.5" />
                    iFrame Code
                  </Button>
                  <Button
                    variant={activeTab === 'js' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setActiveTab('js')}
                  >
                    <FileCode className="w-3 h-3 mr-1.5" />
                    JavaScript Embed
                  </Button>
                </div>

                {activeTab === 'url' && (
                  <div className="space-y-4">
                    {/* Preview URL */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground block">
                        {t.workflow_url_preview_label || 'Preview URL'}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {t.workflow_url_preview_desc || 'Use this URL to preview your chat widget in a browser.'}
                      </p>
                      <div className="p-3 bg-muted rounded-md font-mono text-xs break-all select-all">
                        {previewUrl}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => copyUrl(previewUrl, 'preview')}>
                          {copiedKey === 'preview' ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                          {copiedKey === 'preview' ? (t.copied || 'Copied!') : (t.copy || 'Copy')}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => openInNewTab(previewUrl)}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t.open || 'Open'}
                        </Button>
                      </div>
                    </div>

                    {/* Full Screen URL */}
                    <div className="space-y-2 pt-3 border-t">
                      <label className="text-xs font-medium text-muted-foreground block">
                        {t.workflow_url_fullscreen_label || 'Full Screen URL'}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {t.workflow_url_fullscreen_desc || 'Use this URL for a full-screen chat experience.'}
                      </p>
                      <div className="p-3 bg-muted rounded-md font-mono text-xs break-all select-all">
                        {fullScreenUrl}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => copyUrl(fullScreenUrl, 'full')}>
                          {copiedKey === 'full' ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                          {copiedKey === 'full' ? (t.copied || 'Copied!') : (t.copy || 'Copy')}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => openInNewTab(fullScreenUrl)}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t.open || 'Open'}
                        </Button>
                        {!selfHosted && (
                        <Button variant="outline" onClick={() => setShowQR(!showQR)}>
                          <QrCode className="w-4 h-4" />
                        </Button>
                        )}
                      </div>
                      {showQR && (
                        <div className="flex justify-center p-4 bg-white rounded-lg">
                          <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48" />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'iframe' && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {t.workflow_url_iframe_desc || 'Paste this code in your website\'s HTML to embed as an iframe.'}
                    </p>
                    <Textarea value={iframeCode} readOnly className="font-mono text-xs min-h-[80px]" />
                    <Button variant="outline" className="w-full" onClick={() => handleCopyEmbed(iframeCode)}>
                      {copiedEmbed ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copiedEmbed ? (t.copied || 'Copied!') : 'Copy to Clipboard'}
                    </Button>
                  </div>
                )}

                {activeTab === 'js' && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {t.workflow_url_js_desc || 'Paste this JavaScript code in your website\'s HTML to embed the chat widget. This is the recommended method.'}
                    </p>
                    <Textarea value={jsCode} readOnly className="font-mono text-xs min-h-[150px]" />
                    <Button variant="outline" className="w-full" onClick={() => handleCopyEmbed(jsCode)}>
                      {copiedEmbed ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copiedEmbed ? (t.copied || 'Copied!') : 'Copy to Clipboard'}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-muted rounded-md font-mono text-xs break-all select-all">
                  {displayUrl}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => copyUrl(displayUrl, 'team')}>
                    {copiedKey === 'team' ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copiedKey === 'team' ? (t.copied || 'Copied!') : (t.copy || 'Copy')}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => openInNewTab(displayUrl)}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {t.open || 'Open'}
                  </Button>
                  {!selfHosted && (
                  <Button variant="outline" onClick={() => setShowQR(!showQR)}>
                    <QrCode className="w-4 h-4" />
                  </Button>
                  )}
                </div>
                {showQR && (
                  <div className="flex justify-center p-4 bg-white rounded-lg">
                    <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48" />
                  </div>
                )}
                <div className="text-xs text-muted-foreground text-center">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full dark:bg-blue-900 dark:text-blue-300">
                    {t.team || 'Team'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 text-center space-y-4">
            <div className="flex justify-center">
              <div className="p-4 bg-yellow-100 rounded-full dark:bg-yellow-900">
                <AlertCircle className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
              </div>
            </div>
            <p className="text-muted-foreground">
              {getNoURLMessage()}
            </p>
            <p className="text-xs text-muted-foreground">
              {triggerType === 'schedule' && (
                t.workflow_url_schedule_hint || 'Schedule-triggered workflows run automatically at the configured time.'
              )}
              {triggerType === 'telegram' && (
                t.workflow_url_telegram_hint || 'Telegram-triggered workflows respond to messages from your Telegram bot.'
              )}
              {triggerType === 'pstn' && (
                t.workflow_url_pstn_hint || 'Open the workflow, click the PSTN start node, then Advanced Settings → Web Voice to enable browser calls.'
              )}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

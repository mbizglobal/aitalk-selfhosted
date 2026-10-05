'use client'

import { useEffect, useState, use } from 'react'
import { Loader2 } from 'lucide-react'
import { translations } from '@/lib/translations'

interface ChatPreviewPageProps {
  params: Promise<{
    agentId: string
  }>
  searchParams: Promise<{
    workflowId?: string
    lang?: string
  }>
}

type PreviewStatus = 'loading' | 'ready' | 'error'

declare global {
  interface Window {
    aitalkWidget?: {
      init: (agentId: string, options?: any) => any
      open?: () => void
      close?: () => void
      expand?: () => void
      reset?: () => void
    }
  }
}

const PREVIEW_SCRIPT_ID = 'aitalk-widget-preview-script'

const removeExistingWidgetNodes = () => {
  const nodes = document.querySelectorAll<HTMLElement>('.aitalk-widget-button, .aitalk-widget-container, .aitalk-welcome-message')
  nodes.forEach(node => node.remove())
  const existingAgentScripts = document.querySelectorAll<HTMLScriptElement>('script[data-agent-id]')
  existingAgentScripts.forEach(script => script.remove())
}

export default function ChatPreviewPage({ params, searchParams }: ChatPreviewPageProps) {
  const { agentId } = use(params)
  const { workflowId, lang } = use(searchParams)
  const [status, setStatus] = useState<PreviewStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [currentOrigin, setCurrentOrigin] = useState('')
  const [currentLang, setCurrentLang] = useState<'en' | 'de' | 'fr'>('en')

  // Simple translation function
  const t = (key: string) => {
    const keys = key.split('.')
    let value: any = translations[currentLang]
    for (const k of keys) {
      value = value?.[k]
    }
    return value || key
  }

  useEffect(() => {
    if (!agentId) return

    const browserLang = navigator.language.split('-')[0] as 'en' | 'de' | 'fr'
    const selectedLang =
      lang && ['en', 'de', 'fr'].includes(lang) ? lang as 'en' | 'de' | 'fr' :
        ['en', 'de', 'fr'].includes(browserLang) ? browserLang :
          'en'
    setCurrentLang(selectedLang)

    setStatus('loading')
    setErrorMessage('')
    setCurrentOrigin(window.location.origin)

    let scriptEl: HTMLScriptElement | null = null
    let cleanupNodes: HTMLElement[] = []
    let cancelled = false
    const previewBaseUrl = typeof window !== 'undefined' ? window.location.origin : undefined

    const initializeWidget = () => {
      if (!window.aitalkWidget?.init) {
        setStatus('error')
        setErrorMessage(t('widget_preview_error'))
        return
      }

      cleanupNodes.forEach(node => node.remove())
      cleanupNodes = []
      removeExistingWidgetNodes()

      try {
        const initOptions: any = { preview: true }
        if (previewBaseUrl) {
          initOptions.baseUrl = previewBaseUrl
        }
        if (workflowId) {
          initOptions.workflowId = workflowId
        }

        const result = window.aitalkWidget.init(agentId, initOptions) || {}
        const { button, container } = result

        if (button) cleanupNodes.push(button)
        if (container) cleanupNodes.push(container)

        setTimeout(() => {
          window.aitalkWidget?.open?.()
        }, 500)

        setStatus('ready')
      } catch (error) {
        console.error('Failed to initialise widget preview:', error)
        setStatus('error')
        setErrorMessage(t('widget_preview_error'))
      }
    }

    removeExistingWidgetNodes()
    delete (window as any).aitalkWidget

    const existingScript = document.getElementById(PREVIEW_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript) {
      existingScript.remove()
    }

    scriptEl = document.createElement('script')
    scriptEl.id = PREVIEW_SCRIPT_ID
    scriptEl.src = `/embed.min.js?v=${Date.now()}`
    scriptEl.async = true

    if (previewBaseUrl) {
      scriptEl.dataset.baseUrl = previewBaseUrl
    }

    scriptEl.onload = () => {
      if (cancelled) return
      setTimeout(initializeWidget, 100)
    }

    scriptEl.onerror = () => {
      if (cancelled) return
      setStatus('error')
      setErrorMessage(t('widget_preview_error'))
    }

    document.body.appendChild(scriptEl)

    return () => {
      cancelled = true
      cleanupNodes.forEach(node => node.remove())
      cleanupNodes = []
      if (scriptEl) {
        scriptEl.remove()
      }
      removeExistingWidgetNodes()
    }
  }, [agentId])

  return (
    <>
      <style jsx global>{`
        body {
          margin: 0;
          background: #f3f4f6;
        }
      `}</style>

      <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-10 text-center text-gray-700">
        <div className="max-w-2xl w-full bg-white/80 backdrop-blur rounded-2xl shadow-sm border border-gray-200 px-6 py-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">{t('widget_preview_title')}</h1>
          <p className="text-sm text-gray-500 mb-6">
            {t('widget_preview_description')}
          </p>

          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-gray-400">{t('widget_preview_agent_id')}</span>
              <span className="font-mono text-sm px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-800">
                {agentId}
              </span>
            </div>
            {workflowId && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-gray-400">Workflow ID</span>
                <span className="font-mono text-sm px-3 py-1 rounded-full bg-purple-100 border border-purple-200 text-purple-800">
                  {workflowId}
                </span>
              </div>
            )}
          </div>

          <div className="text-sm text-gray-500">
            {status === 'loading' && (
              <div className="flex items-center justify-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('widget_preview_loading')}</span>
              </div>
            )}
            {status === 'ready' && (
              <div className="space-y-2">
                <p className="text-green-600 font-medium">{t('widget_preview_success')}</p>
                <p>{t('widget_preview_instruction')}</p>
              </div>
            )}
            {status === 'error' && (
              <p className="text-red-500">{errorMessage || t('widget_preview_error')}</p>
            )}
          </div>

          {currentOrigin && (
            <div className="mt-6 p-4 bg-blue-50 rounded-lg text-left text-xs text-gray-600">
              <h4 className="font-semibold mb-2">{t('widget_preview_embed_code')}</h4>
              <pre className="block bg-white p-2 rounded border text-xs overflow-x-auto whitespace-pre-wrap">
{`<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${currentOrigin}/embed.min.js';
    script.setAttribute('data-agent-id', '${agentId}');
    script.setAttribute('data-base-url', '${currentOrigin}');${workflowId ? `
    script.setAttribute('data-workflow-id', '${workflowId}');` : ''}
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
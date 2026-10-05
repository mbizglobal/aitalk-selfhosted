'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, GripHorizontal, CheckCircle2, ChevronRight, Loader2, Copy, Check,
  ExternalLink, CreditCard, Plug, KeyRound, FileText, AlertTriangle, Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useDraggable } from '../hooks/useDraggable'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface AcsInfo {
  subscriptionId: string
  acsResourceName: string
  immutableResourceId: string
}

type StepKey = 1 | 2 | 3 | 4

const AZURE_PORTAL_URL = 'https://portal.azure.com'
const PSTN_REQUEST_FORM_URL = 'https://pstnsd.powerappsportals.com/'
const ACS_TNS_EMAIL = 'acstns@microsoft.com'

const ACS_NUMBER_FORMS: Array<{ label: string; file: string }> = [
  { label: 'Switzerland', file: 'ACS-Manual-Number-Acquisition-Form-for-Switzerland.docx' },
  { label: 'Germany', file: 'ACS-Manual-Number-Acquisition-Form-for-Germany.docx' },
  { label: 'United States / United Kingdom / Canada / Denmark', file: 'ACS-Manual-Number-Acquisition-Form-US-UK-CA-DK.docx' },
  { label: 'Austria', file: 'ACS-Manual-Number-Acquisition-Form-for-Austria.docx' },
  { label: 'Australia', file: 'ACS-Manual-Number-Acquisition-Form-for-Australia.docx' },
  { label: 'Belgium', file: 'ACS-Manual-Number-Acquisition-Form-for-Belgium.docx' },
  { label: 'France', file: 'ACS-Manual-Number-Acquisition-Form-for-France.docx' },
  { label: 'Ireland', file: 'ACS-Manual-Number-Acquisition-Form-for-Ireland.docx' },
  { label: 'Italy', file: 'ACS-Manual-Number-Acquisition-Form-for-Italy.docx' },
  { label: 'Japan', file: 'ACS-Manual-Number-Acquisition-Form-for-Japan.docx' },
  { label: 'Luxembourg', file: 'ACS-Manual-Number-Acquisition-Form-for-Luxembourg.docx' },
  { label: 'Netherlands', file: 'ACS-Manual-Number-Acquisition-Form-for-Netherlands.docx' },
  { label: 'Norway', file: 'ACS-Manual-Number-Acquisition-Form-for-Norway.docx' },
  { label: 'Portugal', file: 'ACS-Manual-Number-Acquisition-Form-for-Portugal.docx' },
  { label: 'Slovakia', file: 'ACS-Manual-Number-Acquisition-Form-for-Slovakia.docx' },
  { label: 'Spain', file: 'ACS-Manual-Number-Acquisition-Form-for-Spain.docx' },
  { label: 'Sweden', file: 'ACS-Manual-Number-Acquisition-Form-for-Sweden.docx' },
  { label: 'Toll-Free (inbound only)', file: 'ACS-Manual-Number-Acquisition-Form-for-TF-InboundOnly.docx' },
]

export function AcsSetupWizardModal() {
  const { ui, agent } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const agentId = agent?.agentId || ''

  const [activeStep, setActiveStep] = useState<StepKey>(1)
  const [connected, setConnected] = useState(false)
  const [acsInfo, setAcsInfo] = useState<AcsInfo | null>(null)

  const [azureConnecting, setAzureConnecting] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [azureTenant, setAzureTenant] = useState('')
  const [showManualConn, setShowManualConn] = useState(false)
  const [manualConn, setManualConn] = useState('')
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [subPicker, setSubPicker] = useState<null | {
    subscriptions: Array<{ subscriptionId: string; displayName: string; state: string }>
  }>(null)
  const [resourcePicker, setResourcePicker] = useState<null | {
    subscriptionId: string
    resources: Array<{ name: string; resourceGroup: string; immutableResourceId: string; dataLocation: string; hostName: string }>
  }>(null)

  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [formFile, setFormFile] = useState('')
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const azureCleanupRef = useRef<(() => void) | null>(null)
  const epochRef = useRef(0)

  const loadConnState = useCallback(async (): Promise<boolean> => {
    if (!agentId) return false
    const epoch = epochRef.current
    try {
      const res = await fetch(`/api/agents/${agentId}/phone-numbers`)
      if (!res.ok) return false
      const data = await res.json()
      if (epochRef.current !== epoch) return false
      setConnected(!!data.hasAcsCallConnection)
      setAcsInfo(data.acsInfo || null)
      return !!data.hasAcsCallConnection
    } catch {
      return false
    }
  }, [agentId])

  useEffect(() => {
    if (!ui.showAcsWizardModal) return
    const epoch = epochRef.current
    setError(null)
    loadConnState().then((isConnected) => {
      if (isConnected && epochRef.current === epoch) setActiveStep((s) => (s === 1 ? 4 : s))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.showAcsWizardModal])

  useEffect(() => () => {
    azureCleanupRef.current?.()
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showAcsWizardModal })

  if (!ui.showAcsWizardModal) return null

  const close = () => {
    epochRef.current += 1
    azureCleanupRef.current?.()
    setSubPicker(null)
    setResourcePicker(null)
    setSessionId(null)
    setError(null)
    setProvisioning(false)
    setAzureConnecting(false)
    setShowManualConn(false)
    setManualConn('')
    setActiveStep(1)
    setFormFile('')
    ui.setShowAcsWizardModal(false)
  }

  const copy = async (key: string, value: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1500)
    } catch {
    }
  }

  const handleAzureConnect = async () => {
    if (!agentId) return
    const epoch = epochRef.current
    azureCleanupRef.current?.()
    setAzureConnecting(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-studio/acs-provision/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, tenant: azureTenant.trim() || undefined }),
      })
      const data = await res.json()
      if (epochRef.current !== epoch) return
      if (!res.ok || !data.authUrl) {
        setError(data.error || 'Failed to start Azure OAuth')
        return
      }
      const popup = window.open(data.authUrl, 'acs-oauth', 'width=520,height=680')
      if (!popup) {
        setError(t.pstn_azure_popup_blocked || 'Popup was blocked. Allow popups for this site and try again.')
        return
      }
      let bc: BroadcastChannel | null = null
      try { bc = new BroadcastChannel('acs_provision') } catch { bc = null }
      let killTimer: ReturnType<typeof setTimeout> | null = null
      const cleanup = () => {
        window.removeEventListener('message', onMessage)
        try { bc?.close() } catch { /* ignore */ }
        try { popup.close() } catch { /* ignore */ }
        if (killTimer) clearTimeout(killTimer)
        if (azureCleanupRef.current === cleanup) azureCleanupRef.current = null
      }
      const handle = (d: any) => {
        if (!d || d.type !== 'acs_provision') return
        cleanup()
        try { popup.close() } catch { /* ignore */ }
        if (epochRef.current !== epoch) return
        if (d.status === 'success' && d.step === 'select_subscription') {
          setSessionId(d.sessionId)
          setSubPicker({ subscriptions: d.subscriptions || [] })
        } else {
          setError(d.message || 'Azure connection failed')
        }
      }
      const onMessage = (ev: MessageEvent) => handle(ev.data)
      if (bc) bc.onmessage = (ev) => handle(ev.data)
      window.addEventListener('message', onMessage)
      azureCleanupRef.current = cleanup
      killTimer = setTimeout(cleanup, 5 * 60 * 1000)
    } catch (err) {
      if (epochRef.current === epoch) setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      if (epochRef.current === epoch) setAzureConnecting(false)
    }
  }

  const handleSubscriptionPick = async (subscriptionId: string) => {
    if (!agentId || !sessionId) return
    const epoch = epochRef.current
    setProvisioning(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-studio/acs-provision/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subscriptionId, agentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (epochRef.current !== epoch) return
      if (!res.ok) {
        setError(data.error || `Failed to list resources (HTTP ${res.status})`)
        return
      }
      const resources = Array.isArray(data.resources) ? data.resources : []
      if (resources.length > 0) {
        setResourcePicker({ subscriptionId, resources })
      } else {
        await handleProvision(subscriptionId)
      }
    } catch (err) {
      if (epochRef.current === epoch) setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      if (epochRef.current === epoch) setProvisioning(false)
    }
  }

  const handleProvision = async (
    subscriptionId: string,
    useExisting?: { resourceGroup: string; acsResourceName: string }
  ) => {
    if (!agentId || !sessionId) return
    const epoch = epochRef.current
    setProvisioning(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-studio/acs-provision/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subscriptionId, agentId, useExisting }),
      })
      const data = await res.json()
      if (epochRef.current !== epoch) return
      if (!res.ok || !data.success) {
        setError(data.error || `Provisioning failed (HTTP ${res.status})`)
        return
      }
      setSubPicker(null)
      setResourcePicker(null)
      await loadConnState()
      if (epochRef.current !== epoch) return
      setConnected(true)
      setActiveStep(3)
    } catch (err) {
      if (epochRef.current === epoch) setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      if (epochRef.current === epoch) setProvisioning(false)
    }
  }

  const handleManualSave = async () => {
    if (!agentId) return
    const trimmed = manualConn.trim()
    if (!trimmed.startsWith('endpoint=')) {
      setError(t.pstn_conn_format)
      return
    }
    const epoch = epochRef.current
    setManualSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents/${agentId}/acs-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionString: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (epochRef.current !== epoch) return
      if (!res.ok) {
        setError(data.error || `Failed (HTTP ${res.status})`)
        return
      }
      setManualConn('')
      setShowManualConn(false)
      await loadConnState()
      if (epochRef.current !== epoch) return
      setConnected(true)
      setActiveStep(3)
    } catch (err) {
      if (epochRef.current === epoch) setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      if (epochRef.current === epoch) setManualSubmitting(false)
    }
  }

  const STEPS: Array<{ key: StepKey; label: string; icon: React.ComponentType<{ className?: string }>; done?: boolean }> = [
    { key: 1, label: t.pstn_wizard_step1_nav || 'Azure account', icon: CreditCard },
    { key: 2, label: t.pstn_wizard_step2_nav || 'Connect Azure', icon: Plug, done: connected },
    { key: 3, label: t.pstn_wizard_step3_nav || 'Your IDs', icon: KeyRound },
    { key: 4, label: t.pstn_wizard_step4_nav || 'Request number', icon: FileText },
  ]

  const IdRow = ({ ck, label, value }: { ck: string; label: string; value: string }) => (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-2.5 py-2 rounded bg-[#0f0f1e] border border-gray-700 text-xs text-gray-200 font-mono truncate">
          {value || '—'}
        </code>
        <button
          type="button"
          onClick={() => copy(ck, value)}
          disabled={!value}
          className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded border border-gray-700 bg-[#1e1e2e] text-xs text-gray-300 hover:text-teal-300 hover:border-teal-500/60 transition-colors disabled:opacity-40"
        >
          {copiedKey === ck ? <Check className="w-3.5 h-3.5 text-teal-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedKey === ck ? (t.pstn_wizard_copied || 'Copied') : (t.pstn_wizard_copy || 'Copy')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] w-full max-w-3xl max-h-[88vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="p-5 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200">{t.pstn_wizard_title || 'Set up your phone number'}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{t.pstn_wizard_subtitle || 'One-time Azure setup to get a phone number for this agent.'}</p>
            </div>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-gray-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <nav className="w-52 border-r border-[#3A3A3A] bg-[#252525] py-3 flex-shrink-0 overflow-y-auto scrollbar-thin">
            {STEPS.map((s) => {
              const Icon = s.icon
              const active = activeStep === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveStep(s.key)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                    active
                      ? 'bg-[#3A3A3A] text-gray-100 border-l-2 border-teal-400'
                      : 'text-gray-400 hover:bg-[#2F2F2F] hover:text-gray-200 border-l-2 border-transparent'
                  }`}
                >
                  <span className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                    s.done ? 'bg-teal-500/20 text-teal-300' : active ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300'
                  }`}>
                    {s.done ? <Check className="w-3 h-3" /> : s.key}
                  </span>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-6 text-sm text-gray-300 leading-relaxed">
            {activeStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-gray-100">{t.pstn_wizard_step1_title || '1. Create a Microsoft Azure account'}</h3>
                <p className="whitespace-pre-line">{t.pstn_wizard_step1_body ||
                  'Create a Microsoft Azure account and sign in. In the portal, open “Subscriptions” and create a Pay-As-You-Go (PAYG) subscription. You will be asked for a credit or debit card.'}</p>
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-amber-300 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t.pstn_wizard_step1_warning ||
                    'Choose Pay-As-You-Go, not the Free Trial — phone numbers cannot be provisioned on Free Trial / free credits.'}</span>
                </div>
                <a href={AZURE_PORTAL_URL} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t.pstn_wizard_open_azure || 'Open Azure Portal'}
                </a>
                <div className="pt-2">
                  <Button size="sm" onClick={() => setActiveStep(2)} className="h-8 text-xs bg-teal-600 hover:bg-teal-500 text-white">
                    {t.pstn_wizard_next || 'Next'} <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── Step 2 — Connect Azure ── */}
            {activeStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-gray-100">{t.pstn_wizard_step2_title || '2. Connect your Azure account'}</h3>

                {connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-teal-500/10 border border-teal-500/30 rounded-md text-teal-300 text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{t.pstn_wizard_step2_connected || 'Azure is connected and your Communication Services resource is ready.'}</span>
                    </div>
                    <Button size="sm" onClick={() => setActiveStep(3)} className="h-8 text-xs bg-teal-600 hover:bg-teal-500 text-white">
                      {t.pstn_wizard_next || 'Next'} <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </Button>
                  </div>
                ) : resourcePicker ? (
                  <div className="border border-teal-700/60 bg-teal-950/20 rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-teal-400 text-xs font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t.pstn_azure_connected || 'Azure connected'}
                    </div>
                    <p className="text-xs text-gray-300">
                      {provisioning
                        ? (t.pstn_azure_provisioning || 'Setting up your Communication Services resource… this can take up to a minute.')
                        : (t.pstn_wizard_pick_resource || 'You already have Communication Services resource(s) in this subscription. Reuse one (we just import its connection), or create a new one.')}
                    </p>
                    {resourcePicker.resources.map((r) => (
                      <button
                        key={r.name}
                        type="button"
                        disabled={provisioning}
                        onClick={() => handleProvision(resourcePicker.subscriptionId, { resourceGroup: r.resourceGroup, acsResourceName: r.name })}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#0f0f1e] border border-gray-700 hover:border-teal-500 hover:bg-teal-950/30 text-xs text-gray-200 disabled:opacity-50 transition-colors"
                      >
                        <span className="flex flex-col items-start min-w-0">
                          <span className="font-medium truncate w-full text-left">{r.name}</span>
                          <span className="text-[10px] text-gray-500 truncate w-full text-left">{r.resourceGroup}{r.dataLocation ? ` · ${r.dataLocation}` : ''}</span>
                        </span>
                        {provisioning
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-teal-400" />
                          : <span className="flex items-center gap-0.5 text-teal-400 shrink-0 text-[11px] font-medium">{t.pstn_wizard_use_resource || 'Use this'}<ChevronRight className="w-3.5 h-3.5" /></span>}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={provisioning}
                      onClick={() => handleProvision(resourcePicker.subscriptionId)}
                      className="w-full text-left px-2.5 py-2 rounded border border-dashed border-gray-600 hover:border-teal-500 text-[11px] text-gray-300 disabled:opacity-50 transition-colors"
                    >
                      + {t.pstn_wizard_create_new || 'Create a new resource instead'}
                    </button>
                    {!provisioning && (
                      <button type="button" onClick={() => setResourcePicker(null)} className="text-[10px] text-gray-500 hover:text-gray-300">
                        {t.pstn_wizard_back || 'Back'}
                      </button>
                    )}
                  </div>
                ) : subPicker ? (
                  <div className="border border-teal-700/60 bg-teal-950/20 rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-teal-400 text-xs font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t.pstn_azure_connected || 'Azure connected'}
                    </div>
                    <p className="text-xs text-gray-300">
                      {provisioning
                        ? (t.pstn_azure_provisioning || 'Setting up… this can take up to a minute.')
                        : (t.pstn_wizard_pick_sub || 'Pick the Pay-As-You-Go subscription to use.')}
                    </p>
                    {subPicker.subscriptions.map((s) => (
                      <button
                        key={s.subscriptionId}
                        type="button"
                        disabled={provisioning}
                        onClick={() => handleSubscriptionPick(s.subscriptionId)}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#0f0f1e] border border-gray-700 hover:border-teal-500 hover:bg-teal-950/30 text-xs text-gray-200 disabled:opacity-50 transition-colors"
                      >
                        <span className="flex flex-col items-start min-w-0">
                          <span className="font-medium truncate w-full text-left">{s.displayName}</span>
                          <span className="text-[10px] text-gray-500">{s.state}</span>
                        </span>
                        {provisioning
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-teal-400" />
                          : <span className="flex items-center gap-0.5 text-teal-400 shrink-0 text-[11px] font-medium">{t.pstn_azure_use_sub || 'Continue'}<ChevronRight className="w-3.5 h-3.5" /></span>}
                      </button>
                    ))}
                    {!provisioning && (
                      <button type="button" onClick={() => setSubPicker(null)} className="text-[10px] text-gray-500 hover:text-gray-300">
                        {t.pstn_cancel || 'Cancel'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-300">{t.pstn_wizard_step2_body ||
                      'Sign in once and we create the Communication Services (ACS) resource for you automatically.'}</p>
                    <Button type="button" size="sm" onClick={handleAzureConnect} disabled={azureConnecting}
                            className="w-full h-9 text-xs bg-blue-600 hover:bg-blue-500 text-white">
                      {azureConnecting
                        ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />{t.pstn_azure_connecting || 'Connecting…'}</>
                        : (t.pstn_azure_connect || 'Connect Azure account')}
                    </Button>
                    <div>
                      <Input
                        value={azureTenant}
                        onChange={(e) => setAzureTenant(e.target.value)}
                        placeholder={t.pstn_azure_tenant_ph || 'Azure Tenant ID (personal account only)'}
                        className="bg-[#0f0f1e] border-gray-700 text-xs h-7 font-mono"
                      />
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {t.pstn_azure_tenant_hint ||
                          'Personal Microsoft account (outlook.com etc.)? Enter your Azure tenant ID — Azure Portal → Microsoft Entra ID → Overview → Tenant ID. Work/school accounts: leave blank.'}
                      </p>
                    </div>
                    <div className="pt-0.5">
                      <button type="button" onClick={() => setShowManualConn((v) => !v)}
                              className="text-[10px] text-gray-500 hover:text-gray-300 underline decoration-dotted">
                        {showManualConn
                          ? (t.pstn_acs_manual_hide || 'Hide manual setup')
                          : (t.pstn_acs_manual_show || 'Advanced: paste an ACS connection string manually')}
                      </button>
                      {showManualConn && (
                        <div className="mt-1.5 space-y-1.5">
                          <Textarea
                            value={manualConn}
                            onChange={(e) => setManualConn(e.target.value)}
                            placeholder="endpoint=https://acs-payg.europe.communication.azure.com/;accesskey=..."
                            className="bg-[#0f0f1e] border-gray-700 text-xs min-h-[60px] font-mono"
                          />
                          <div className="flex justify-end">
                            <Button size="sm" onClick={handleManualSave} disabled={manualSubmitting || manualConn.trim().length === 0}
                                    className="h-7 text-xs bg-teal-600 hover:bg-teal-500 text-white">
                              {manualSubmitting ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />{t.pstn_saving}</> : t.pstn_save}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            )}

            {/* ── Step 3 — IDs ── */}
            {activeStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-gray-100">{t.pstn_wizard_step3_title || '3. Copy your Azure IDs'}</h3>
                {!connected ? (
                  <div className="flex items-start gap-2 p-3 bg-[#1a1a28] border border-gray-700 rounded-md text-xs text-gray-400">
                    <Plug className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t.pstn_wizard_step3_not_connected || 'Connect your Azure account in Step 2 first.'}</span>
                  </div>
                ) : acsInfo ? (
                  <>
                    <p className="text-xs text-gray-300">{t.pstn_wizard_step3_body ||
                      'You will need these two IDs to fill out the phone number request form in the next step. Copy them now.'}</p>
                    <IdRow ck="sub" label={t.pstn_wizard_subscription_id || 'Azure Subscription ID'} value={acsInfo.subscriptionId} />
                    <IdRow ck="imm" label={t.pstn_wizard_immutable_id || 'Azure Immutable Resource ID'} value={acsInfo.immutableResourceId} />
                    {!acsInfo.immutableResourceId && (
                      <p className="text-[11px] text-amber-300 leading-snug -mt-1">
                        {t.pstn_wizard_immutable_missing ||
                          'We couldn’t read this automatically — find it in Azure Portal → your Communication Services resource → Overview / Properties (Immutable Resource ID).'}
                      </p>
                    )}
                    {acsInfo.acsResourceName && (
                      <IdRow ck="name" label={t.pstn_wizard_resource_name || 'Communication Services resource'} value={acsInfo.acsResourceName} />
                    )}
                    <Button size="sm" onClick={() => setActiveStep(4)} className="h-8 text-xs bg-teal-600 hover:bg-teal-500 text-white">
                      {t.pstn_wizard_next || 'Next'} <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </Button>
                  </>
                ) : (
                  <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t.pstn_wizard_step3_manual ||
                      'You connected manually, so we don’t have these IDs. Find them in Azure Portal → your Communication Services resource → Overview (Subscription ID and Immutable Resource ID).'}</span>
                  </div>
                )}
              </div>
            )}

            {activeStep === 4 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-gray-100">{t.pstn_wizard_step4_title || '4. Request your phone number'}</h3>
                <p className="whitespace-pre-line text-xs text-gray-300">{t.pstn_wizard_step4_body ||
                  'In Azure Portal, open the Communication Services resource you just created, then go to the “Regulatory / Phone numbers” request page. Submit a request:'}</p>

                <div className="space-y-2">
                  <div className="p-3 rounded-md bg-[#1a1a28] border border-gray-700">
                    <p className="text-xs font-medium text-gray-200 mb-1">{t.pstn_wizard_step4_business_title || 'Business account'}</p>
                    <p className="text-[11px] text-gray-400 mb-2">{t.pstn_wizard_step4_business_body || 'Submit the online form at the Phone Number Service Center.'}</p>
                    <a href={PSTN_REQUEST_FORM_URL} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] transition-colors">
                      <ExternalLink className="w-3 h-3" />
                      {t.pstn_wizard_open_form || 'Open request form'}
                    </a>
                  </div>
                  <div className="p-3 rounded-md bg-[#1a1a28] border border-gray-700 space-y-2.5">
                    <p className="text-xs font-medium text-gray-200">{t.pstn_wizard_step4_personal_title || 'Personal account'}</p>
                    <p className="text-[11px] text-gray-400 leading-snug">{t.pstn_wizard_step4_personal_body ||
                      'The online form is for business accounts only. Download your country’s form, fill it in, and email it to the Azure number team.'}</p>

                    <div className="flex items-center gap-2">
                      <Select value={formFile} onValueChange={setFormFile}>
                        <SelectTrigger className="bg-[#0f0f1e] border-gray-700 text-xs h-8 flex-1">
                          <SelectValue placeholder={t.pstn_wizard_form_select || 'Select country / form'} />
                        </SelectTrigger>
                        <SelectContent>
                          {ACS_NUMBER_FORMS.map((f) => (
                            <SelectItem key={f.file} value={f.file}>{f.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <a
                        href={formFile ? `/acs-forms/${formFile}` : undefined}
                        download
                        aria-disabled={!formFile}
                        onClick={(e) => { if (!formFile) e.preventDefault() }}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded text-[11px] transition-colors ${
                          formFile
                            ? 'bg-blue-600 hover:bg-blue-500 text-white'
                            : 'bg-gray-700/50 text-gray-500 cursor-not-allowed pointer-events-none'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        {t.pstn_wizard_form_download || 'Download'}
                      </a>
                    </div>

                    <p className="text-[11px] text-gray-400 leading-snug">
                      {t.pstn_wizard_step4_personal_email || 'Then email the completed form to'}{' '}
                      <a href={`mailto:${ACS_TNS_EMAIL}?subject=${encodeURIComponent('ACS Number Request')}`}
                         className="text-teal-300 hover:text-teal-200 underline">{ACS_TNS_EMAIL}</a>
                      {t.pstn_wizard_step4_personal_subject ? (
                        <span className="block text-gray-500 mt-0.5">{t.pstn_wizard_step4_personal_subject}</span>
                      ) : (
                        <span className="block text-gray-500 mt-0.5">Subject: “ACS Number Request - &lt;Country&gt;”.</span>
                      )}
                    </p>
                  </div>
                </div>

                {acsInfo && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] text-gray-500">{t.pstn_wizard_step4_ids_hint || 'Paste these into the request form / document:'}</p>
                    <IdRow ck="sub4" label={t.pstn_wizard_subscription_id || 'Azure Subscription ID'} value={acsInfo.subscriptionId} />
                    <IdRow ck="imm4" label={t.pstn_wizard_immutable_id || 'Azure Immutable Resource ID'} value={acsInfo.immutableResourceId} />
                    {!acsInfo.immutableResourceId && (
                      <p className="text-[11px] text-amber-300 leading-snug -mt-1">
                        {t.pstn_wizard_immutable_missing ||
                          'We couldn’t read this automatically — find it in Azure Portal → your Communication Services resource → Overview / Properties (Immutable Resource ID).'}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-start gap-2 p-3 bg-teal-500/10 border border-teal-500/20 rounded-md text-[11px] text-gray-300">
                  <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                  <span>{t.pstn_wizard_step4_after ||
                    'Once Microsoft provisions your number (usually a few business days), come back here and add it with the “+” button — your Azure connection is already saved.'}</span>
                </div>

                <Button size="sm" onClick={close} className="h-8 text-xs bg-teal-600 hover:bg-teal-500 text-white">
                  {t.pstn_wizard_done || 'Done'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

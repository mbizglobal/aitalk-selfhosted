'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Calendar,
  Loader2,
  Link as LinkIcon,
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Plus,
  Info,
  Save as SaveIcon,
  Trash2,
  ChevronDown,
  ChevronRight,
  LogOut,
  Sliders,
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
  provider: 'google_workspace' | 'microsoft_workspace'
}

interface AppConnection {
  id: string
  provider: string
  label: string
  description?: string
  status: string
}

interface CalendarOption {
  id: string
  summary?: string
  name?: string
  primary?: boolean
}

interface CalendarAccount {
  id: string
  ownerEmail: string
  label?: string
  status: string
  tokenExpiresAt?: string
}

const TIMEZONES: Array<{ group: string; options: Array<{ value: string; label: string }> }> = [
  {
    group: 'Europe',
    options: [
      { value: 'Europe/Zurich',    label: 'Zurich · Switzerland' },
      { value: 'Europe/Berlin',    label: 'Berlin · Germany' },
      { value: 'Europe/Paris',     label: 'Paris · France' },
      { value: 'Europe/London',    label: 'London · UK' },
      { value: 'Europe/Madrid',    label: 'Madrid · Spain' },
      { value: 'Europe/Stockholm', label: 'Stockholm · Sweden' },
      { value: 'Europe/Amsterdam', label: 'Amsterdam · Netherlands' },
      { value: 'Europe/Vienna',    label: 'Vienna · Austria' },
    ],
  },
  {
    group: 'USA',
    options: [
      { value: 'America/New_York',    label: 'New York · ET Eastern' },
      { value: 'America/Chicago',     label: 'Chicago · CT Central' },
      { value: 'America/Denver',      label: 'Denver · MT Mountain' },
      { value: 'America/Phoenix',     label: 'Phoenix · Arizona (no DST)' },
      { value: 'America/Los_Angeles', label: 'Los Angeles · PT Pacific' },
      { value: 'America/Anchorage',   label: 'Anchorage · Alaska' },
      { value: 'Pacific/Honolulu',    label: 'Honolulu · Hawaii (no DST)' },
    ],
  },
  {
    group: 'Canada',
    options: [
      { value: 'America/Toronto',   label: 'Toronto · Eastern' },
      { value: 'America/Winnipeg',  label: 'Winnipeg · Central' },
      { value: 'America/Edmonton',  label: 'Edmonton · Mountain' },
      { value: 'America/Vancouver', label: 'Vancouver · Pacific' },
      { value: 'America/Halifax',   label: 'Halifax · Atlantic' },
    ],
  },
  {
    group: 'Asia',
    options: [
      { value: 'Asia/Seoul',     label: 'Seoul · Korea' },
      { value: 'Asia/Tokyo',     label: 'Tokyo · Japan' },
      { value: 'Asia/Singapore', label: 'Singapore' },
    ],
  },
  {
    group: 'Australia',
    options: [
      { value: 'Australia/Sydney',    label: 'Sydney · NSW (AEDT/AEST)' },
      { value: 'Australia/Melbourne', label: 'Melbourne · VIC (AEDT/AEST)' },
      { value: 'Australia/Brisbane',  label: 'Brisbane · QLD (no DST)' },
      { value: 'Australia/Adelaide',  label: 'Adelaide · SA (ACDT/ACST)' },
      { value: 'Australia/Perth',     label: 'Perth · WA (no DST)' },
    ],
  },
  {
    group: 'Other',
    options: [
      { value: 'UTC', label: 'UTC' },
    ],
  },
]


const SETUP_GUIDE_URLS: Record<string, string> = {
  en: 'https://support.aitalk.ch/english/calendar/calendar-setup-guide',
  de: 'https://support.aitalk.ch/german/kalender/kalender-einrichtungsanleitung',
  fr: 'https://support.aitalk.ch/french/agenda/guide-de-configuration-de-lagenda',
  ko: 'https://support.aitalk.ch/korean/calendar/calendar-setup-guide',
}

export const CalendarToolPanel: React.FC<Props> = ({ node, updateNodeData, provider }) => {
  const { agent, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const isGoogle = provider === 'google_workspace'
  const providerLabel = isGoogle ? 'Google Calendar' : 'Microsoft Calendar'
  const vendorLabel = isGoogle ? 'Google Cloud' : 'Azure AD'
  const brandColor = isGoogle ? '#4285F4' : '#0078D4'
  const basePath = isGoogle ? '/api/agent-studio/google-calendar' : '/api/agent-studio/microsoft-calendar'
  const connectionPath = `${basePath}/connection`
  const authorizePath = `${basePath}/authorize`
  const disconnectPath = `${basePath}/disconnect`
  const calendarsPath = `${basePath}/calendars`
  const postMessageType = isGoogle ? 'google_calendar_oauth' : 'microsoft_calendar_oauth'

  const [connections, setConnections] = useState<AppConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [calendars, setCalendars] = useState<CalendarOption[]>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)

  // Tier 2 — Gmail/Microsoft Accounts (3-tier multi-calendar)
  const [accounts, setAccounts] = useState<CalendarAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountsError, setAccountsError] = useState(false)
  const [accountRemoving, setAccountRemoving] = useState<string | null>(null)
  const accountsReqRef = useRef(0)
  const accountsPath = `${basePath}/accounts`

  // Creds form state
  const [byoClientId, setByoClientId] = useState('')
  const [byoClientSecret, setByoClientSecret] = useState('')
  const [byoLabel, setByoLabel] = useState('')
  const [byoSaving, setByoSaving] = useState(false)
  const [byoConnecting, setByoConnecting] = useState(false)
  const [byoDeleting, setByoDeleting] = useState(false)
  const [byoDisconnecting, setByoDisconnecting] = useState(false)
  const [clientSecretStored, setClientSecretStored] = useState(false)

  const [newMode, setNewMode] = useState<'shared' | 'byo'>(isGoogle ? 'byo' : 'shared')
  const [connMode, setConnMode] = useState<'shared' | 'byo'>('byo')
  const [quickConnecting, setQuickConnecting] = useState(false)

  // View state
  const [addingNew, setAddingNew] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const byoRedirectUri = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const origin = window.location.origin
    return `${origin}${basePath}/callback`
  }, [basePath])

  const connectionId: string = node.data.connectionId || ''
  const accountId: string = node.data.accountId || ''
  const calendarId = node.data.calendarId || 'primary'
  const timezone = node.data.timezone || 'Europe/Zurich'
  const workingHoursStart = node.data.workingHoursStart || '09:00'
  const workingHoursEnd = node.data.workingHoursEnd || '18:00'

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === connectionId) || null,
    [connections, connectionId]
  )
  const isActive = selectedConnection?.status === 'active'
  const isExpired = selectedConnection?.status === 'expired'

  const selectedAccountActive = useMemo(
    () => !!accountId && accounts.some((a) => a.id === accountId && a.status === 'active'),
    [accounts, accountId]
  )
  const accountReady = !accountsLoaded || accountsError || selectedAccountActive

  const hasStaleConnection =
    !!connectionId && connections.length > 1 && !connections.some((c) => c.id === connectionId)

  const loadConnections = useCallback(async () => {
    if (!agent.agentId) return
    setLoadingConnections(true)
    try {
      const res = await fetch(
        `/api/agent-studio/app-connections?agentId=${agent.agentId}&providers=${provider}&statuses=active,expired`
      )
      if (res.ok) {
        const data = await res.json()
        setConnections(data.connections || [])
      }
    } finally {
      setLoadingConnections(false)
    }
  }, [agent.agentId, provider])

  const loadCalendars = useCallback(async () => {
    if (!isActive) {
      setCalendars([])
      return
    }
    const query = accountId
      ? `accountId=${accountId}`
      : connectionId
        ? `connectionId=${connectionId}`
        : ''
    if (!query) {
      setCalendars([])
      return
    }
    setLoadingCalendars(true)
    setCalendarError(null)
    try {
      const res = await fetch(`${calendarsPath}?${query}`)
      const data = await res.json()
      if (res.ok && data.success) {
        setCalendars(data.calendars || [])
      } else {
        setCalendarError(data.error || 'Failed to load calendars')
      }
    } catch (err: any) {
      setCalendarError(err?.message || 'Failed to load calendars')
    } finally {
      setLoadingCalendars(false)
    }
  }, [connectionId, accountId, calendarsPath, isActive])

  const loadAccounts = useCallback(async () => {
    if (!connectionId || !isActive) {
      accountsReqRef.current++
      setAccounts([])
      setAccountsLoaded(false)
      setAccountsError(false)
      return
    }
    const reqId = ++accountsReqRef.current
    setLoadingAccounts(true)
    setAccountsLoaded(false)
    setAccountsError(false)
    try {
      const res = await fetch(`${accountsPath}?connectionId=${connectionId}`)
      const data = await res.json()
      if (reqId !== accountsReqRef.current) return
      if (res.ok && data.success) {
        setAccounts(data.accounts || [])
      } else {
        setAccounts([])
        setAccountsError(true)
      }
    } catch {
      if (reqId !== accountsReqRef.current) return
      setAccounts([])
      setAccountsError(true)
    } finally {
      if (reqId === accountsReqRef.current) {
        setLoadingAccounts(false)
        setAccountsLoaded(true)
      }
    }
  }, [connectionId, accountsPath, isActive])

  const loadSelectedConnectionCreds = useCallback(async () => {
    if (!connectionId) {
      setByoClientId('')
      setByoClientSecret('')
      setByoLabel('')
      setClientSecretStored(false)
      return
    }
    try {
      const res = await fetch(`${connectionPath}?connectionId=${connectionId}`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.success) return
      setByoClientId(data.connection.oauthClientId || '')
      setByoClientSecret('')
      setByoLabel(data.connection.label || '')
      setClientSecretStored(!!data.connection.hasClientSecret)
      setConnMode(data.connection.oauthMode === 'shared' ? 'shared' : 'byo')
    } catch {
      /* ignore */
    }
  }, [connectionId, connectionPath])

  useEffect(() => { loadConnections() }, [loadConnections])
  useEffect(() => { loadCalendars() }, [loadCalendars])
  useEffect(() => { loadSelectedConnectionCreds() }, [loadSelectedConnectionCreds])
  useEffect(() => { loadAccounts() }, [loadAccounts])

  useEffect(() => {
    if (!isActive || !accountsLoaded) return
    if (selectedAccountActive) return
    const nextActive = accounts.find((a) => a.status === 'active')
    if (nextActive && nextActive.id !== accountId) {
      updateNodeData({ accountId: nextActive.id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, accountId, isActive, accountsLoaded, selectedAccountActive])

  useEffect(() => {
    if (!isGoogle) return
    if (calendarId !== 'primary') return
    const primaryCal = calendars.find((c) => c.primary)
    if (primaryCal && primaryCal.id !== 'primary') {
      updateNodeData({ calendarId: primaryCal.id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendars, calendarId, isGoogle])

  useEffect(() => {
    if (addingNew) return
    if (connections.length === 0) return
    const currentValid = connectionId && connections.some((c) => c.id === connectionId)
    if (currentValid) return
    if (!connectionId || connections.length === 1) {
      updateNodeData({ connectionId: connections[0].id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, connectionId, addingNew])

  useEffect(() => {
    setEditOpen(false)
  }, [connectionId])

  // ─────────────────────────────── Actions ───────────────────────────────

  const handleSaveNew = async () => {
    if (!agent.agentId) return
    if (!byoClientId.trim() || !byoClientSecret.trim()) return
    setByoSaving(true)
    try {
      const res = await fetch(connectionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          label: byoLabel.trim() || undefined,
          oauthClientId: byoClientId.trim(),
          oauthClientSecret: byoClientSecret.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to save credentials')
        return
      }
      await loadConnections()
      updateNodeData({ connectionId: data.connectionId })
      setByoClientSecret('')
      setClientSecretStored(true)
      setAddingNew(false)
      setEditOpen(false)
    } catch (err: any) {
      alert(err?.message || 'Failed to save credentials')
    } finally {
      setByoSaving(false)
    }
  }

  const handleQuickConnect = async () => {
    if (!agent.agentId) return
    setQuickConnecting(true)
    try {
      const res = await fetch(connectionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          label: byoLabel.trim() || undefined,
          oauthMode: 'shared',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to start quick connect')
        return
      }
      await loadConnections()
      updateNodeData({ connectionId: data.connectionId })
      setAddingNew(false)
      setEditOpen(false)

      const authRes = await fetch(authorizePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: data.connectionId }),
      })
      const authData = await authRes.json()
      if (!authRes.ok || !authData.authUrl) {
        alert(authData.error || 'Failed to start OAuth')
        return
      }
      openAuthPopup(authData.authUrl)
    } catch (err: any) {
      alert(err?.message || 'Failed to start quick connect')
    } finally {
      setQuickConnecting(false)
    }
  }

  const handleSaveExisting = async () => {
    if (!connectionId) return
    if (!byoClientId.trim()) return
    if (!byoClientSecret.trim()) {
      alert(t.calendar_secret_required_alert || 'Enter Client Secret to save changes. (Secret is never displayed after saving.)')
      return
    }
    setByoSaving(true)
    try {
      const res = await fetch(connectionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          connectionId,
          label: byoLabel.trim() || undefined,
          oauthClientId: byoClientId.trim(),
          oauthClientSecret: byoClientSecret.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to save credentials')
        return
      }
      await loadConnections()
      setByoClientSecret('')
      setClientSecretStored(true)
      setEditOpen(false)
    } catch (err: any) {
      alert(err?.message || 'Failed to save credentials')
    } finally {
      setByoSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!connectionId) return
    const confirmed = window.confirm(
      `${(t.calendar_disconnect_confirm_title || 'Disconnect your {provider} account?').replace('{provider}', isGoogle ? 'Google' : 'Microsoft')}\n\n${t.calendar_disconnect_confirm_body || 'This revokes the OAuth tokens only. Your Client ID/Secret stays saved — you can reconnect without re-entering credentials.'}`
    )
    if (!confirmed) return
    setByoDisconnecting(true)
    try {
      const res = await fetch(disconnectPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to disconnect')
        return
      }
      await loadConnections()
      setCalendars([])
    } catch (err: any) {
      alert(err?.message || 'Failed to disconnect')
    } finally {
      setByoDisconnecting(false)
    }
  }

  const handleDelete = async () => {
    if (!connectionId) return
    const deleteBody =
      !isGoogle && connMode === 'shared'
        ? (t.calendar_delete_confirm_body_quick || 'This removes the connection and its OAuth tokens. You can reconnect anytime with Quick connect.')
        : (t.calendar_delete_confirm_body || 'This removes the saved Client ID/Secret and any OAuth tokens. You can still reuse the same OAuth Client in {vendor} — just re-enter the credentials later.').replace('{vendor}', vendorLabel)
    const confirmed = window.confirm(
      `${t.calendar_delete_confirm_title || 'Delete this connection?'}\n\n${deleteBody}`
    )
    if (!confirmed) return
    setByoDeleting(true)
    try {
      const res = await fetch(`${connectionPath}?connectionId=${connectionId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete connection')
        return
      }
      updateNodeData({ connectionId: '' })
      await loadConnections()
      setByoClientId('')
      setByoClientSecret('')
      setByoLabel('')
      setClientSecretStored(false)
      setEditOpen(false)
    } catch (err: any) {
      alert(err?.message || 'Failed to delete connection')
    } finally {
      setByoDeleting(false)
    }
  }

  const openAuthPopup = (authUrl: string) => {
    const popup = window.open(authUrl, 'calendar-oauth', 'width=520,height=680')
    const onMessage = (ev: MessageEvent) => {
      if (!ev.data || ev.data.type !== postMessageType) return
      window.removeEventListener('message', onMessage)
      if (ev.data.status === 'success') {
        loadConnections()
        loadAccounts()
        if (ev.data.connectionId) {
          updateNodeData({ connectionId: ev.data.connectionId })
        }
      } else {
        alert(ev.data.message || 'Connection failed')
      }
      try { popup?.close() } catch { /* ignore */ }
    }
    window.addEventListener('message', onMessage)
  }

  const handleConnect = async () => {
    const effectiveId =
      connectionId && connections.some((c) => c.id === connectionId)
        ? connectionId
        : connections[0]?.id
    if (!effectiveId) return
    setByoConnecting(true)
    try {
      const res = await fetch(authorizePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: effectiveId }),
      })
      const data = await res.json()
      if (!res.ok || !data.authUrl) {
        alert(data.error || 'Failed to start OAuth')
        return
      }
      openAuthPopup(data.authUrl)
    } catch (err: any) {
      alert(err?.message || 'Failed to start OAuth')
    } finally {
      setByoConnecting(false)
    }
  }

  const copyRedirectUri = async () => {
    try { await navigator.clipboard.writeText(byoRedirectUri) } catch { /* ignore */ }
  }

  const handleRemoveAccount = async (acc: CalendarAccount) => {
    const confirmTitle = t.calendar_remove_account_confirm_title || 'Remove this account?'
    const confirmBody =
      t.calendar_remove_account_confirm_body ||
      'This revokes its OAuth tokens. Calendar nodes that use it will need a different account assigned first.'
    const confirmed = window.confirm(`${confirmTitle}\n\n${acc.ownerEmail}\n\n${confirmBody}`)
    if (!confirmed) return

    setAccountRemoving(acc.id)
    try {
      const res = await fetch(`${accountsPath}?accountId=${acc.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.status === 409 && data.error === 'account_in_use') {
        const inUseTitle = t.calendar_remove_account_in_use_title || 'Account is still in use'
        const inUseBody =
          t.calendar_remove_account_in_use_body || 'Remove or reassign these calendar nodes first, then try again:'
        const list = (data.inUseBy || [])
          .map((u: any) => `  • ${u.workflowName} → ${u.nodeLabel}`)
          .join('\n')
        alert(`${inUseTitle}\n\n${inUseBody}\n${list}`)
        return
      }
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to remove account')
        return
      }
      if (accountId === acc.id) updateNodeData({ accountId: '' })
      await loadAccounts()
    } catch (err: any) {
      alert(err?.message || 'Failed to remove account')
    } finally {
      setAccountRemoving(null)
    }
  }

  const hasConnection = connections.length > 0
  const showNewForm = !hasConnection || addingNew

  const setupInfo = (t.calendar_setup_info || 'Create an OAuth client in your own {vendor} project so your data stays in your account.')
    .replace('{vendor}', vendorLabel)
  const redirectUriLabel = (t.calendar_redirect_uri_label || 'Redirect URI (paste this into {vendor})')
    .replace('{vendor}', vendorLabel)
  const storedPlaceholder = t.calendar_secret_stored_placeholder || '●●●●●● stored'
  const storedHint = t.calendar_secret_stored || '(stored — enter new value to change)'

  const CredsFields = (
    <>
      <div className="flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-gray-300 leading-relaxed">
          {setupInfo}{' '}
          <a href={SETUP_GUIDE_URLS[lang] || SETUP_GUIDE_URLS[lang.split('-')[0]] || SETUP_GUIDE_URLS.en} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300 underline">
            {t.calendar_setup_guide_link || 'Setup guide'} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">{redirectUriLabel}</label>
        <div className="flex items-center gap-1">
          <Input readOnly value={byoRedirectUri} autoComplete="off"
                 className="flex-1 bg-[#0F0F0F] border-[#3A3A3A] text-gray-300 text-xs"
                 onFocus={(e) => e.target.select()} />
          <Button variant="outline" size="sm" onClick={copyRedirectUri} className="text-xs px-2">
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">{t.calendar_connection_label_field || 'Connection label (optional)'}</label>
        <Input value={byoLabel} onChange={(e) => setByoLabel(e.target.value)}
               placeholder={providerLabel} autoComplete="off"
               className="bg-[#0F0F0F] border-[#3A3A3A] text-gray-200" />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Client ID</label>
        <Input value={byoClientId} onChange={(e) => setByoClientId(e.target.value)}
               placeholder={isGoogle ? '...apps.googleusercontent.com' : 'Azure AD Application (client) ID'}
               autoComplete="off" spellCheck={false}
               className="bg-[#0F0F0F] border-[#3A3A3A] text-gray-200 font-mono text-xs" />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Client Secret{' '}
          {clientSecretStored && !byoClientSecret && (
            <span className="text-emerald-400 font-normal">{storedHint}</span>
          )}
        </label>
        <Input type="password" value={byoClientSecret}
               onChange={(e) => setByoClientSecret(e.target.value)}
               placeholder={clientSecretStored ? storedPlaceholder : (isGoogle ? 'GOCSPX-...' : 'Azure AD client secret value')}
               autoComplete="new-password" spellCheck={false}
               className="bg-[#0F0F0F] border-[#3A3A3A] text-gray-200 font-mono text-xs" />
      </div>
    </>
  )

  const ModeToggle = !isGoogle && (
    <div className="grid grid-cols-2 gap-1 p-0.5 rounded bg-[#0F0F0F] border border-[#3A3A3A]">
      {(['shared', 'byo'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setNewMode(m)}
          className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
            newMode === m ? 'bg-[#2A2A2A] text-gray-100' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {m === 'shared'
            ? (t.calendar_mode_quick || 'Quick connect')
            : (t.calendar_mode_byo || 'Direct connection')}
        </button>
      ))}
    </div>
  )

  const QuickConnectFields = (
    <>
      <div className="flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-gray-300 leading-relaxed">
          {t.calendar_mode_quick_desc ||
            'Sign in with your Microsoft account — no Azure setup needed. AiTalk manages the app registration; your calendar data is accessed through the AiTalk app.'}
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">{t.calendar_connection_label_field || 'Connection label (optional)'}</label>
        <Input value={byoLabel} onChange={(e) => setByoLabel(e.target.value)}
               placeholder={providerLabel} autoComplete="off"
               className="bg-[#0F0F0F] border-[#3A3A3A] text-gray-200" />
      </div>

      <Button onClick={handleQuickConnect}
              disabled={quickConnecting}
              className="w-full text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: brandColor }}>
        {quickConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
        {t.calendar_quick_connect_button || 'Sign in with Microsoft'}
      </Button>
      <p className="text-xs text-gray-500 leading-relaxed">
        {t.calendar_quick_admin_consent_hint ||
          'Personal accounts connect instantly. Work or school (M365) accounts may need admin approval depending on tenant policy.'}
      </p>
    </>
  )

  const NewCredsForm = (
    <div className="p-3 rounded bg-[#1a1a1a] border border-[#3A3A3A] space-y-3">
      {ModeToggle}
      {!isGoogle && newMode === 'shared' ? (
        QuickConnectFields
      ) : (
        <>
          {CredsFields}
          <Button onClick={handleSaveNew}
                  disabled={byoSaving || !byoClientId.trim() || !byoClientSecret.trim()}
                  className="w-full text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: (byoClientId.trim() && byoClientSecret.trim()) ? brandColor : '#3A3A3A' }}>
            {byoSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <SaveIcon className="w-4 h-4 mr-2" />}
            {t.calendar_save_credentials || 'Save credentials'}
          </Button>
        </>
      )}
      {hasConnection && addingNew && (
        <button type="button" onClick={() => {
          setAddingNew(false)
          setByoClientId('')
          setByoClientSecret('')
          setByoLabel('')
        }} className="block w-full text-center text-xs text-gray-400 hover:text-gray-200">
          {t.cancel || 'Cancel'}
        </button>
      )}
    </div>
  )

  const EditCredsPanel = !isGoogle && connMode === 'shared' ? (
    <div className="rounded border border-[#3A3A3A] bg-[#1a1a1a] px-3 py-2 flex items-center justify-between gap-2">
      <span className="text-xs text-gray-400 flex items-center gap-1.5 min-w-0">
        <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="truncate">{t.calendar_mode_quick_badge || 'Quick connect (AiTalk managed)'}</span>
      </span>
      <Button onClick={handleDelete}
              disabled={byoDeleting}
              variant="outline"
              size="sm"
              className="border-red-900/50 text-red-400 hover:text-red-300 hover:border-red-800 disabled:opacity-40 shrink-0">
        {byoDeleting ? <Loader2 className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
      </Button>
    </div>
  ) : (
    <div className="rounded border border-[#3A3A3A] bg-[#1a1a1a]">
      <button
        type="button"
        onClick={() => setEditOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:text-gray-100"
      >
        {editOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {t.calendar_edit_credentials || 'Edit credentials'}
      </button>
      {editOpen && (
        <div className="px-3 pb-3 space-y-3">
          {CredsFields}
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSaveExisting}
                    disabled={byoSaving || !byoClientId.trim() || !byoClientSecret.trim()}
                    variant="outline"
                    className="flex-1 border-[#3A3A3A] text-gray-200 disabled:opacity-40">
              {byoSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <SaveIcon className="w-4 h-4 mr-2" />}
              {t.calendar_save_changes || 'Save changes'}
            </Button>
            <Button onClick={handleDelete}
                    disabled={byoDeleting}
                    variant="outline"
                    className="border-red-900/50 text-red-400 hover:text-red-300 hover:border-red-800 disabled:opacity-40">
              {byoDeleting ? <Loader2 className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded" style={{ backgroundColor: brandColor }}>
          <Calendar className="w-4 h-4 text-white" />
        </div>
        <h3 className="text-sm font-semibold text-gray-200">{providerLabel}</h3>
      </div>

      {/* Connection */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400 block">{t.calendar_connection || 'Connection'}</label>

        {loadingConnections ? (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> {t.calendar_loading || 'loading…'}
          </div>
        ) : !hasConnection ? (
          NewCredsForm
        ) : (
          <>
            {connections.length > 1 && (
              <select
                value={hasStaleConnection ? '__missing__' : connectionId}
                onChange={(e) => updateNodeData({ connectionId: e.target.value })}
                className="w-full bg-[#1F1F1F] border border-[#3A3A3A] rounded px-2 py-1.5 text-sm text-gray-200"
              >
                {hasStaleConnection && (
                  <option value="__missing__" disabled>
                    {t.calendar_connection_missing || 'Imported connection not found — select a connection'}
                  </option>
                )}
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.description || c.label) + (c.status === 'expired' ? ' (not connected)' : '')}
                  </option>
                ))}
              </select>
            )}
            {connections.length === 1 && isActive && (
              <div className="text-sm text-gray-300 truncate">
                {selectedConnection?.description || selectedConnection?.label}
              </div>
            )}

            {!addingNew && hasStaleConnection && (
              <p className="text-xs text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {t.calendar_connection_missing_hint || 'Select a connection above to fix this calendar.'}
              </p>
            )}

            {!addingNew && !isActive && !hasStaleConnection && (
              <>
                <Button
                  onClick={handleConnect}
                  disabled={byoConnecting}
                  className="w-full text-white"
                  style={{ backgroundColor: brandColor }}
                >
                  {byoConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                  {(t.calendar_connect_button || 'Connect {provider}').replace('{provider}', providerLabel)}
                </Button>
                <p className="text-xs text-amber-400/80 text-center">
                  {!isGoogle && connMode === 'shared'
                    ? (t.calendar_quick_saved_hint || 'Click Connect to sign in with your Microsoft account.')
                    : (t.calendar_creds_saved_hint || 'Credentials saved — click Connect to authorize with your {provider} account.').replace('{provider}', isGoogle ? 'Google' : 'Microsoft')}
                </p>
              </>
            )}

            {!addingNew && isActive && (
              <div className="flex items-center justify-between gap-2 py-1">
                {accountReady ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {t.calendar_connected || 'Connected'}
                  </span>
                ) : (
                  <span className="text-xs text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {t.calendar_account_not_linked || 'Account not linked — Reconnect'}
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={byoConnecting}
                    className="text-xs text-gray-400 hover:text-gray-200 underline"
                  >
                    {byoConnecting ? (t.calendar_loading || 'loading…') : (t.calendar_reconnect || 'Reconnect')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={byoDisconnecting}
                    className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1"
                  >
                    {byoDisconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                    {t.calendar_disconnect || 'Disconnect'}
                  </button>
                </div>
              </div>
            )}

            {!addingNew && EditCredsPanel}

            {addingNew && NewCredsForm}
          </>
        )}
      </div>

      {isActive && hasConnection && !addingNew && (
        <div className="space-y-2 border-t border-[#3A3A3A] pt-3">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">
              {isGoogle
                ? (t.calendar_gmail_accounts || 'Gmail Accounts')
                : (t.calendar_microsoft_accounts || 'Microsoft Accounts')}
              {accounts.length > 0 && <span className="ml-1 text-gray-500">({accounts.length})</span>}
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleConnect}
              disabled={byoConnecting}
              className="text-xs px-2 border-[#3A3A3A]"
              title={t.calendar_connect_another_account}
            >
              {byoConnecting ? <Loader2 className="w-3 h-3 mr-0.5 animate-spin" /> : <Plus className="w-3 h-3 mr-0.5" />}
              {t.calendar_connect_another_account || 'Connect another account'}
            </Button>
          </div>
          {accounts.length >= 2 && (
            <p className="text-xs text-gray-500">
              {t.calendar_account_select_hint || 'Click a row to choose which account this calendar node uses.'}
            </p>
          )}
          {loadingAccounts ? (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> {t.calendar_account_loading || 'loading accounts…'}
            </div>
          ) : accountsError ? (
            <div className="text-xs text-amber-400 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {t.calendar_account_load_error || 'Could not load accounts.'}
              </span>
              <button type="button" onClick={() => loadAccounts()} className="underline hover:text-amber-300">
                {t.calendar_account_retry || 'Retry'}
              </button>
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-xs text-gray-500">
              {t.calendar_account_no_accounts || 'No accounts connected. Click Connect to add one.'}
            </div>
          ) : (
            <div className="space-y-1">
              {accounts.map((acc) => {
                const selected = accountId === acc.id
                return (
                  <div
                    key={acc.id}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => updateNodeData({ accountId: acc.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        updateNodeData({ accountId: acc.id })
                      }
                    }}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#1F2A1F] border border-emerald-600/60'
                        : 'bg-[#1F1F1F] border border-[#2A2A2A] hover:border-[#3A3A3A]'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        selected ? 'border-emerald-500 bg-emerald-500/20' : 'border-[#3A3A3A]'
                      }`}>
                        {selected && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 truncate">{acc.ownerEmail}</div>
                        <div className={`text-xs ${acc.status === 'active' ? 'text-emerald-500/80' : 'text-amber-400/80'}`}>
                          {acc.status === 'active'
                            ? (t.calendar_account_active || 'Active')
                            : (t.calendar_account_expired || 'Reauth needed')}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemoveAccount(acc) }}
                      disabled={accountRemoving === acc.id}
                      className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1 shrink-0 px-1"
                      title={t.calendar_account_remove || 'Remove'}
                    >
                      {accountRemoving === acc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {accountId && accounts.length > 0 && !accounts.find((a) => a.id === accountId) && (
            <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {t.calendar_orphan_account_warning || 'This calendar is missing its account.'}
            </p>
          )}
        </div>
      )}

      {connectionId && !addingNew && (
        <>
          {isActive && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t.calendar_target || 'Target Calendar'}</label>
              {loadingCalendars ? (
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> {t.calendar_loading_calendars || 'loading calendars…'}
                </div>
              ) : calendarError ? (
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertCircle className="w-3 h-3" /> {calendarError}
                </div>
              ) : (
                <select value={calendarId} onChange={(e) => updateNodeData({ calendarId: e.target.value })}
                        className="w-full bg-[#1F1F1F] border border-[#3A3A3A] rounded px-2 py-1.5 text-sm text-gray-200">
                  {isGoogle && calendars.length === 0 && (
                    <option value="primary">primary</option>
                  )}
                  {!isGoogle && !calendarId && <option value="">default</option>}
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.summary || c.name || c.id) + (c.primary ? ' (primary)' : '')}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Timezone */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t.calendar_timezone || 'Timezone'}</label>
            <select value={timezone} onChange={(e) => updateNodeData({ timezone: e.target.value })}
                    className="w-full bg-[#1F1F1F] border border-[#3A3A3A] rounded px-2 py-1.5 text-sm text-gray-200">
              {TIMEZONES.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>{`${o.label} (${o.value})`}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Working Hours */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t.calendar_working_hours || 'Working Hours'}</label>
            <div className="flex items-center gap-2">
              <Input type="time" value={workingHoursStart}
                     onChange={(e) => updateNodeData({ workingHoursStart: e.target.value })}
                     autoComplete="off" className="flex-1 bg-[#1F1F1F] border-[#3A3A3A] text-gray-200" />
              <span className="text-gray-400 text-sm">—</span>
              <Input type="time" value={workingHoursEnd}
                     onChange={(e) => updateNodeData({ workingHoursEnd: e.target.value })}
                     autoComplete="off" className="flex-1 bg-[#1F1F1F] border-[#3A3A3A] text-gray-200" />
            </div>
          </div>

          <p className="text-xs text-gray-500">
            {t.calendar_duration_moved_hint || 'Booking duration, cleanup time and start times are set in Advanced Settings › Capacity & Duration.'}
          </p>

          {/* Advanced Settings — Channels / Caller Questions / Invite Attendee / Visitor Identity / History Lookup */}
          <div className="pt-2 space-y-2">
            <Button
              variant="outline"
              onClick={() => {
                ui.setCalendarAdvancedModalNodeId(node.id)
                ui.setShowCalendarAdvancedModal(true)
              }}
              className="w-full border-[#3A3A3A] bg-[#1F1F1F] text-gray-200 hover:bg-[#2A2A2A] hover:text-gray-100 justify-center"
            >
              <Sliders className="w-4 h-4 mr-2" />
              {t.cal_adv_button || 'Advanced Settings'}
            </Button>
            <p className="text-xs text-gray-500 mt-1.5 text-center">
              {t.cal_adv_button_hint ||
                'Channels, caller questions, visitor identity, and history lookup.'}
            </p>

            <Button
              variant="outline"
              onClick={() => {
                ui.setCalendarMonthlyPreviewNodeId(node.id)
                ui.setShowCalendarMonthlyPreviewModal(true)
              }}
              className="w-full border-[#3A3A3A] bg-[#1F1F1F] text-gray-200 hover:bg-[#2A2A2A] hover:text-gray-100 justify-center"
            >
              <Calendar className="w-4 h-4 mr-2" />
              {t.cal_preview_btn || 'Configuration Preview'}
            </Button>
            <p className="text-xs text-gray-500 mt-1.5 text-center">
              {t.cal_preview_btn_hint ||
                'Visualize closed days and holidays on a monthly calendar.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

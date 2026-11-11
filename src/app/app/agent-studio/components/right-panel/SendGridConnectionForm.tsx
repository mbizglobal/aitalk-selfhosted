'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Key } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

const FROM_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

interface Props {
  agentId: string
  onChanged?: () => void
}

export const SendGridConnectionForm: React.FC<Props> = ({ agentId, onChanged }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [savedFrom, setSavedFrom] = useState({ fromEmail: '', fromName: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromSaved, setFromSaved] = useState(false)

  const load = useCallback(async () => {
    if (!agentId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/agent-studio/sendgrid?agentId=${agentId}`)
      const data = await res.json()
      setHasStoredKey(res.ok && !!data.hasApiKey)
      const f = { fromEmail: data.fromEmail || '', fromName: data.fromName || '' }
      setSavedFrom(f)
      setFromEmail(f.fromEmail)
      setFromName(f.fromName)
    } catch (err) {
      console.error('Failed to load API key status:', err)
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/agent-studio/sendgrid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || t.failed_save_api_key)
  }

  const handleSaveApiKey = async () => {
    if (!agentId || !apiKey) return
    setSaving(true)
    setError(null)
    try {
      await post({ apiKey })
      setHasStoredKey(true)
      setApiKey('')
      onChanged?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveFrom = async () => {
    if (fromEmail.trim() && !FROM_RE.test(fromEmail.trim())) { setError(t.sendgrid_conn_from_invalid); return }
    setSaving(true)
    setError(null)
    try {
      await post({ fromEmail: fromEmail.trim(), fromName: fromName.trim() })
      setSavedFrom({ fromEmail: fromEmail.trim(), fromName: fromName.trim() })
      setFromSaved(true)
      setTimeout(() => setFromSaved(false), 2000)
      onChanged?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteApiKey = async () => {
    if (!agentId) return
    if (!confirm(t.confirm_remove_api_key)) return
    try {
      const res = await fetch(`/api/agent-studio/sendgrid?agentId=${agentId}`, { method: 'DELETE' })
      if (res.ok) {
        setHasStoredKey(false)
        setSavedFrom({ fromEmail: '', fromName: '' })
        setFromEmail('')
        setFromName('')
        onChanged?.()
      }
    } catch (err) {
      console.error('Failed to delete API key:', err)
    }
  }

  const fromDirty = fromEmail.trim() !== savedFrom.fromEmail || fromName.trim() !== savedFrom.fromName

  return (
    <div className="space-y-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Key className="w-4 h-4 text-gray-400" />
        <label className="text-sm font-medium text-gray-200">{t.sendgrid_api_key}</label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : hasStoredKey ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-400">{t.api_key_configured}</span>
          </div>
          <button onClick={handleDeleteApiKey} className="text-xs text-gray-400 hover:text-red-400 transition-colors">
            {t.remove_api_key}
          </button>

          <div className="space-y-2 pt-2 border-t border-[#3A3A3A]">
            <label className="block text-sm font-medium text-gray-200">{t.sendgrid_conn_from_title}</label>
            <p className="text-[11px] text-gray-500">{t.sendgrid_conn_from_hint}</p>
            <Input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="noreply@example.com"
              autoComplete="off"
              className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
            />
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder={`${t.from_name} (${t.optional})`}
              autoComplete="off"
              className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
            />
            <Button onClick={handleSaveFrom} disabled={saving || !fromDirty} className="w-full" size="sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : fromSaved ? t.sendgrid_conn_from_saved : t.sendgrid_conn_from_save}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="SG.xxxx..."
              autoComplete="new-password"
              className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button onClick={handleSaveApiKey} disabled={saving || !apiKey} className="w-full" size="sm">
            {saving ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t.saving}</>) : t.save_api_key}
          </Button>
          <p className="text-xs text-gray-500">
            {t.get_api_key_from}{' '}
            <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" rel="noopener noreferrer" className="text-[#00A9D1] hover:underline">
              {t.sendgrid_settings}
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

'use client'

import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

export const SmtpConnectionForm: React.FC<{ agentId: string; onChanged?: () => void }> = ({ agentId, onChanged }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [secure, setSecure] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const portNo = Number(port)
  const ready = !!(agentId && host.trim() && Number.isInteger(portNo) && portNo >= 1 && portNo <= 65535 && user.trim() && password)
  const post = async (testOnly: boolean) => {
    if (!ready) return
    setBusy(testOnly ? 'test' : 'save')
    setError(null)
    setOk(null)
    try {
      const res = await fetch('/api/agent-studio/smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, host: host.trim(), port: portNo, user: user.trim(), password, secure, testOnly }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Connection failed')
      if (testOnly) setOk(t.smtp_test_success)
      else {
        setOk(t.smtp_save_success)
        setPassword('')
        onChanged?.()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const field = 'bg-[#2A2A2A] border-[#3A3A3A] text-gray-200'
  return (
    <div className="space-y-2 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-xs text-green-400">{ok}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Input className={`col-span-2 ${field}`} value={host} onChange={(e) => setHost(e.target.value)} placeholder={t.host} autoComplete="off" />
        <Input className={field} value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder={t.port} inputMode="numeric" autoComplete="off" />
      </div>
      <Input className={field} value={user} onChange={(e) => setUser(e.target.value)} placeholder={t.username} autoComplete="off" />
      <Input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.password} autoComplete="new-password" />
      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
        {t.use_ssl}
      </label>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" disabled={!ready || busy !== null} onClick={() => post(true)}>
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : t.test_connection}
        </Button>
        <Button size="sm" className="flex-1" disabled={!ready || busy !== null} onClick={() => post(false)}>
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : t.save}
        </Button>
      </div>
    </div>
  )
}

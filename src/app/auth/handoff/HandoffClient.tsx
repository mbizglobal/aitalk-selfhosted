'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { signOut } from 'next-auth/react'

const L = {
  en: { signoutFailed: 'We couldn’t sign out the account already open in this browser. Sign out on the web, then tap “Open on the web” in the app again.', unknownQ: (next: string) => `We couldn’t check who is signed in on this browser. Open as ${next}?`, opening: 'Signing you in…', opened: (e: string) => `Opened as ${e}`, switchQ: (cur: string, next: string) => `This browser is signed in as ${cur}. Open as ${next} instead?`, switchBtn: 'Switch and open', cancel: 'Cancel', cancelled: 'Nothing was changed. You can close this page.', failed: 'This link has expired or was already used. Tap “Open on the web” in the app again.' },
  de: { signoutFailed: 'Das in diesem Browser angemeldete Konto konnte nicht abgemeldet werden. Melden Sie sich im Web ab und tippen Sie in der App erneut auf «Im Web öffnen».', unknownQ: (next: string) => `Wir konnten nicht prüfen, wer in diesem Browser angemeldet ist. Als ${next} öffnen?`, opening: 'Anmeldung läuft…', opened: (e: string) => `Geöffnet als ${e}`, switchQ: (cur: string, next: string) => `Dieser Browser ist als ${cur} angemeldet. Stattdessen als ${next} öffnen?`, switchBtn: 'Wechseln und öffnen', cancel: 'Abbrechen', cancelled: 'Es wurde nichts geändert. Sie können diese Seite schliessen.', failed: 'Dieser Link ist abgelaufen oder wurde schon benutzt. Tippen Sie in der App erneut auf «Im Web öffnen».' },
  fr: { signoutFailed: 'Impossible de déconnecter le compte déjà ouvert dans ce navigateur. Déconnectez-vous sur le web, puis touchez à nouveau « Ouvrir sur le web » dans l’application.', unknownQ: (next: string) => `Impossible de vérifier qui est connecté sur ce navigateur. Ouvrir en tant que ${next} ?`, opening: 'Connexion en cours…', opened: (e: string) => `Ouvert en tant que ${e}`, switchQ: (cur: string, next: string) => `Ce navigateur est connecté en tant que ${cur}. Ouvrir plutôt en tant que ${next} ?`, switchBtn: 'Changer et ouvrir', cancel: 'Annuler', cancelled: 'Rien n’a été modifié. Vous pouvez fermer cette page.', failed: 'Ce lien a expiré ou a déjà été utilisé. Touchez à nouveau « Ouvrir sur le web » dans l’application.' },
  ko: { signoutFailed: '이 브라우저에 열려 있던 계정을 로그아웃하지 못했습니다. 웹에서 로그아웃한 뒤 앱에서 「웹에서 열기」 를 다시 눌러 주세요.', unknownQ: (next: string) => `이 브라우저에 누가 로그인되어 있는지 확인하지 못했습니다. ${next} 계정으로 열까요?`, opening: '로그인하는 중…', opened: (e: string) => `${e} 계정으로 열었습니다`, switchQ: (cur: string, next: string) => `이 브라우저는 ${cur} 계정으로 로그인되어 있습니다. ${next} 계정으로 바꿔서 열까요?`, switchBtn: '바꿔서 열기', cancel: '취소', cancelled: '아무것도 바꾸지 않았습니다. 이 화면을 닫으셔도 됩니다.', failed: '이 링크는 시간이 지났거나 이미 썼습니다. 앱에서 「웹에서 열기」 를 다시 눌러 주세요.' },
} as const
type Lang = keyof typeof L
type Peek = { kind: 'owner' | 'member'; email: string; agentId: string; path: string }
type Current = { owner: string | null | 'unknown'; member: string | null }
type State = { step: 'opening' } | { step: 'ask'; peek: Peek; current: string | null } | { step: 'opened'; email: string } | { step: 'cancelled' } | { step: 'failed' } | { step: 'signoutFailed' }

const post = (body: object) => fetch('/api/auth/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin' })

const memberKey = (agentId: string) => `team_auth_${agentId}`

async function currentAccount(p: Peek): Promise<Current> {
  let owner: Current['owner']
  try {
    const r = await fetch('/api/auth/session', { cache: 'no-store' })
    const s = r.ok ? await r.json() : undefined
    owner = s === undefined ? 'unknown' : typeof s?.user?.email === 'string' ? s.user.email : null
  } catch { owner = 'unknown' }
  let member: string | null = null
  try {
    const a = JSON.parse(localStorage.getItem(memberKey(p.agentId)) ?? 'null')
    member = a && typeof a.member?.email === 'string' && a.expiresAt * 1000 > Date.now() ? a.member.email : null
  } catch { member = null }
  return { owner, member }
}

export default function HandoffClient() {
  const [lang, setLang] = useState<Lang>('en')
  const [state, setState] = useState<State>({ step: 'opening' })
  const code = useRef<string | null>(null)
  const started = useRef(false)

  const open = (email: string, path: string) => {
    setState({ step: 'opened', email })
    setTimeout(() => window.location.replace(path), 1200)
  }

  const ownerNow = () => fetch('/api/auth/session', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : { user: 'unknown' })).then((x) => !!x?.user).catch(() => true)

  const take = async (peek: Peek, confirmed: boolean) => {
    setState({ step: 'opening' })
    const cur = await currentAccount(peek)
    const want = peek.email.toLowerCase()
    if (!confirmed) {
      if (cur.owner === 'unknown') { setState({ step: 'ask', peek, current: null }); return }
      const other = [cur.owner, cur.member].find((e) => e !== null && e.toLowerCase() !== want)
      if (other) { setState({ step: 'ask', peek, current: other }); return }
    }
    if (peek.kind === 'owner' && typeof cur.owner === 'string' && cur.owner.toLowerCase() === want && peek.path.startsWith('/chat/')) {
      code.current = null
      try { localStorage.removeItem(memberKey(peek.agentId)) } catch { }
      open(peek.email, peek.path)
      return
    }
    const r = await post({ code: code.current }).catch(() => null)
    code.current = null
    const j = r?.ok ? await r.json().catch(() => null) : null
    if (!j || typeof j.path !== 'string' || !j.path.startsWith('/chat/')) { setState({ step: 'failed' }); return }
    if (j.kind === 'member') {
      try { localStorage.setItem(memberKey(j.agentId), JSON.stringify({ token: j.token, expiresAt: j.expiresAt, member: j.member, agentId: j.agentId })) } catch { setState({ step: 'failed' }); return }
      if (await ownerNow()) {
        await signOut({ redirect: false }).catch(() => {})
        if (await ownerNow()) { setState({ step: 'signoutFailed' }); return }
      }
    } else {
      try { localStorage.removeItem(memberKey(j.agentId)) } catch { }
    }
    open(j.email, j.path)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    const nav = (navigator.language || 'en').slice(0, 2)
    if (nav in L) setLang(nav as Lang)
    code.current = window.location.hash.slice(1) || null
    window.history.replaceState(null, '', window.location.pathname)
    if (!code.current) { setState({ step: 'failed' }); return }
    void (async () => {
      const r = await post({ code: code.current, peek: true }).catch(() => null)
      const peek: Peek | null = r?.ok ? await r.json().catch(() => null) : null
      if (!peek) { setState({ step: 'failed' }); return }
      await take(peek, false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const m = L[lang]
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl text-center break-words">
            {state.step === 'opened' ? m.opened(state.email) : state.step === 'ask' ? (state.current === null ? m.unknownQ(state.peek.email) : m.switchQ(state.current, state.peek.email)) : state.step === 'cancelled' ? m.cancelled : state.step === 'failed' ? m.failed : state.step === 'signoutFailed' ? m.signoutFailed : m.opening}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(state.step === 'opening' || state.step === 'opened') && (
            <div className="flex items-center justify-center py-2"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          )}
          {state.step === 'ask' && (
            <div className="space-y-2">
              <Button className="w-full" onClick={() => void take(state.peek, true)}>{m.switchBtn}</Button>
              <Button variant="outline" className="w-full" onClick={() => { code.current = null; setState({ step: 'cancelled' }) }}>{m.cancel}</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

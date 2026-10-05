'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useLanguage } from '@/hooks/useLanguage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

const STRINGS = {
  en: {
    title: 'Access pending', desc: 'Your account needs a partner code or our approval before you can start.',
    code_label: 'Partner code', code_ph: 'e.g. ch-abc-1234', activate: 'Activate', back_signin: 'Sign out',
    awaiting: 'No code?', request: 'Request a trial', request_hint: 'Tell us about your company — we’ll review and email you once approved.',
    err_invalid: 'Invalid or inactive partner code.', err_general: 'Something went wrong. Please try again.',
  },
  de: {
    title: 'Zugang ausstehend', desc: 'Ihr Konto benötigt einen Partnercode oder unsere Freigabe, bevor Sie starten können.',
    code_label: 'Partnercode', code_ph: 'z. B. ch-abc-1234', activate: 'Aktivieren', back_signin: 'Abmelden',
    awaiting: 'Kein Code?', request: 'Testphase anfragen', request_hint: 'Erzählen Sie uns von Ihrem Unternehmen — wir prüfen und melden uns per E-Mail.',
    err_invalid: 'Ungültiger oder inaktiver Partnercode.', err_general: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
  },
  fr: {
    title: 'Accès en attente', desc: 'Votre compte nécessite un code partenaire ou notre approbation avant de commencer.',
    code_label: 'Code partenaire', code_ph: 'ex. ch-abc-1234', activate: 'Activer', back_signin: 'Se déconnecter',
    awaiting: 'Pas de code ?', request: 'Demander un essai', request_hint: 'Parlez-nous de votre entreprise — nous examinerons et vous écrirons.',
    err_invalid: 'Code partenaire invalide ou inactif.', err_general: 'Une erreur est survenue. Veuillez réessayer.',
  },
  es: {
    title: 'Acceso pendiente', desc: 'Tu cuenta necesita un código de socio o nuestra aprobación antes de empezar.',
    code_label: 'Código de socio', code_ph: 'p. ej. ch-abc-1234', activate: 'Activar', back_signin: 'Cerrar sesión',
    awaiting: '¿Sin código?', request: 'Solicitar una prueba', request_hint: 'Cuéntanos sobre tu empresa — lo revisaremos y te avisaremos por correo.',
    err_invalid: 'Código de socio no válido o inactivo.', err_general: 'Algo salió mal. Inténtalo de nuevo.',
  },
  ko: {
    title: '접근 대기 중', desc: '시작하려면 파트너 코드를 입력하거나 저희 승인이 필요합니다.',
    code_label: '파트너 코드', code_ph: '예: ch-abc-1234', activate: '활성화', back_signin: '로그아웃',
    awaiting: '코드가 없으신가요?', request: '트라이얼 요청', request_hint: '회사 정보를 알려주시면 검토 후 승인되면 이메일로 안내드립니다.',
    err_invalid: '유효하지 않거나 비활성 파트너 코드입니다.', err_general: '문제가 발생했습니다. 다시 시도해 주세요.',
  },
} as const

function pick(lang: string) {
  const key = (lang === 'de-ch' ? 'de' : lang) as keyof typeof STRINGS
  return STRINGS[key] || STRINGS.en
}

export default function AccessGatePage() {
  const { currentLanguage } = useLanguage()
  const L = pick(currentLanguage)
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!code.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/auth/apply-partner-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), language: currentLanguage }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.code === 'INVALID_CODE' ? L.err_invalid : L.err_general)
        setLoading(false)
        return
      }
      router.replace('/app')
    } catch {
      setError(L.err_general)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{L.title}</CardTitle>
          <CardDescription>{L.desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="space-y-2">
              <Label htmlFor="gate-code">{L.code_label}</Label>
              <Input id="gate-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={L.code_ph} disabled={loading} autoComplete="off" />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {L.activate}
            </Button>

            <div className="border-t pt-4 text-center space-y-2">
              <p className="text-sm text-muted-foreground">{L.awaiting}</p>
              <Button type="button" variant="outline" className="w-full" onClick={() => router.push('/contact-trial')} disabled={loading}>
                {L.request}
              </Button>
              <p className="text-xs text-muted-foreground">{L.request_hint}</p>
            </div>

            <Button type="button" variant="ghost" className="w-full" onClick={() => signOut({ callbackUrl: '/auth' })} disabled={loading}>
              {L.back_signin}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

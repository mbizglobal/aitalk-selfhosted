'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, CheckCircle2 } from 'lucide-react'

type Step = 'loading' | 'hidden' | 'account_type' | 'ask' | 'form' | 'done'
type AccountType = 'company' | 'individual'

const STRINGS = {
  en: {
    title: 'Welcome! Set up your AI agent',
    acct_title: 'Quick question',
    acct_desc: 'Are you setting up AI Talk for a company or for personal use?',
    acct_company: 'For a company', acct_individual: 'For personal use',
    ask_desc: 'Will you use an AI Voice Agent for your business? Tell us a bit so your agent can answer questions.',
    ask_yes: 'Yes, set it up', ask_later: 'Later',
    form_title: 'Tell us about your business',
    form_desc: 'This becomes your agent’s knowledge. You can edit it later.',
    q_address: 'Address / how to find us', q_services: 'Services and pricing', q_hours: 'Business hours',
    q_holidays: 'Holidays / closed days', q_other: 'Other information', submit: 'Save',
    error_empty: 'Please fill in at least one field, or choose “Later”.',
    error_no_agent: 'Your agent is not ready yet. Please try again shortly, or choose “Later”.',
    error_save: 'Could not save. Please try again.',
    error_finish: 'Saved, but could not finish. Please try again.',
    done_title: 'All set!',
    done_desc: 'Your business info is being indexed (this takes a moment). Your agent will use it shortly.',
    done_cta: 'Go to dashboard', done_call: '🎙️ Call your AI now',
  },
  de: {
    title: 'Willkommen! Richten Sie Ihren KI-Agenten ein',
    acct_title: 'Kurze Frage',
    acct_desc: 'Richten Sie AI Talk für ein Unternehmen oder für den privaten Gebrauch ein?',
    acct_company: 'Für ein Unternehmen', acct_individual: 'Für den privaten Gebrauch',
    ask_desc: 'Möchten Sie einen KI-Sprachagenten für Ihr Unternehmen nutzen? Erzählen Sie uns etwas, damit Ihr Agent Fragen beantworten kann.',
    ask_yes: 'Ja, einrichten', ask_later: 'Später',
    form_title: 'Erzählen Sie uns von Ihrem Unternehmen',
    form_desc: 'Dies wird zum Wissen Ihres Agenten. Sie können es später bearbeiten.',
    q_address: 'Adresse / Anfahrt', q_services: 'Leistungen und Preise', q_hours: 'Öffnungszeiten',
    q_holidays: 'Feiertage / Ruhetage', q_other: 'Weitere Informationen', submit: 'Speichern',
    error_empty: 'Bitte füllen Sie mindestens ein Feld aus oder wählen Sie „Später“.',
    error_no_agent: 'Ihr Agent ist noch nicht bereit. Bitte versuchen Sie es bald erneut oder wählen Sie „Später“.',
    error_save: 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
    error_finish: 'Gespeichert, aber nicht abgeschlossen. Bitte erneut versuchen.',
    done_title: 'Fertig!',
    done_desc: 'Ihre Unternehmensdaten werden verarbeitet (das dauert einen Moment). Ihr Agent nutzt sie in Kürze.',
    done_cta: 'Zum Dashboard', done_call: '🎙️ Jetzt Ihre KI anrufen',
  },
  fr: {
    title: 'Bienvenue ! Configurez votre agent IA',
    acct_title: 'Petite question',
    acct_desc: 'Configurez-vous AI Talk pour une entreprise ou pour un usage personnel ?',
    acct_company: 'Pour une entreprise', acct_individual: 'Pour un usage personnel',
    ask_desc: 'Utiliserez-vous un agent vocal IA pour votre entreprise ? Donnez-nous quelques infos pour que votre agent puisse répondre aux questions.',
    ask_yes: 'Oui, configurer', ask_later: 'Plus tard',
    form_title: 'Parlez-nous de votre entreprise',
    form_desc: 'Cela devient les connaissances de votre agent. Vous pourrez le modifier plus tard.',
    q_address: 'Adresse / comment nous trouver', q_services: 'Services et tarifs', q_hours: 'Heures d’ouverture',
    q_holidays: 'Jours fériés / fermetures', q_other: 'Autres informations', submit: 'Enregistrer',
    error_empty: 'Veuillez remplir au moins un champ ou choisir « Plus tard ».',
    error_no_agent: 'Votre agent n’est pas encore prêt. Réessayez bientôt ou choisissez « Plus tard ».',
    error_save: 'Échec de l’enregistrement. Veuillez réessayer.',
    error_finish: 'Enregistré, mais impossible de terminer. Veuillez réessayer.',
    done_title: 'C’est prêt !',
    done_desc: 'Vos informations sont en cours d’indexation (cela prend un instant). Votre agent les utilisera sous peu.',
    done_cta: 'Aller au tableau de bord', done_call: '🎙️ Appelez votre IA maintenant',
  },
  es: {
    title: '¡Bienvenido! Configura tu agente de IA',
    acct_title: 'Una pregunta rápida',
    acct_desc: '¿Configuras AI Talk para una empresa o para uso personal?',
    acct_company: 'Para una empresa', acct_individual: 'Para uso personal',
    ask_desc: '¿Usarás un agente de voz con IA para tu negocio? Cuéntanos un poco para que tu agente pueda responder preguntas.',
    ask_yes: 'Sí, configurar', ask_later: 'Más tarde',
    form_title: 'Cuéntanos sobre tu negocio',
    form_desc: 'Esto se convierte en el conocimiento de tu agente. Puedes editarlo después.',
    q_address: 'Dirección / cómo encontrarnos', q_services: 'Servicios y precios', q_hours: 'Horario',
    q_holidays: 'Festivos / días cerrados', q_other: 'Otra información', submit: 'Guardar',
    error_empty: 'Completa al menos un campo o elige “Más tarde”.',
    error_no_agent: 'Tu agente aún no está listo. Inténtalo de nuevo en breve o elige “Más tarde”.',
    error_save: 'No se pudo guardar. Inténtalo de nuevo.',
    error_finish: 'Guardado, pero no se pudo finalizar. Inténtalo de nuevo.',
    done_title: '¡Listo!',
    done_desc: 'Tu información se está indexando (tarda un momento). Tu agente la usará en breve.',
    done_cta: 'Ir al panel', done_call: '🎙️ Llama a tu IA ahora',
  },
  ko: {
    title: '환영합니다! AI 에이전트를 설정하세요',
    acct_title: '간단한 질문',
    acct_desc: 'AI Talk을 회사용으로 설정하시나요, 개인용으로 설정하시나요?',
    acct_company: '회사용', acct_individual: '개인용',
    ask_desc: '사업에 AI 음성 에이전트를 사용하시겠어요? 에이전트가 질문에 답할 수 있도록 정보를 알려주세요.',
    ask_yes: '네, 설정할게요', ask_later: '나중에',
    form_title: '사업 정보를 알려주세요',
    form_desc: '이 내용이 에이전트의 지식이 됩니다. 나중에 수정할 수 있어요.',
    q_address: '주소 / 찾아오는 방법', q_services: '서비스 내용 및 가격', q_hours: '영업시간',
    q_holidays: '휴무일', q_other: '기타 정보', submit: '저장',
    error_empty: '한 항목 이상 입력하거나 "나중에"를 선택하세요.',
    error_no_agent: '에이전트가 아직 준비되지 않았습니다. 잠시 후 다시 시도하거나 "나중에"를 선택하세요.',
    error_save: '저장하지 못했습니다. 다시 시도해 주세요.',
    error_finish: '저장됐지만 마무리하지 못했습니다. 다시 시도해 주세요.',
    done_title: '완료되었습니다!',
    done_desc: '사업 정보를 처리 중입니다(잠시 걸립니다). 곧 에이전트가 사용합니다.',
    done_cta: '대시보드로', done_call: '🎙️ 지금 AI에게 전화하기',
  },
} as const

const EXTRA = {
  en: {
    intro_label: 'Intro message (what your AI says first)',
    intro_default: "You're currently on the AI Talk trial, and you can edit this message. The business information you entered has been saved, and I'll only answer questions related to it. Feel free to ask me anything.",
    edit_title: 'Edit your AI', edit_desc: 'Update what your AI knows and how it greets callers.',
  },
  de: {
    intro_label: 'Begrüßung (was Ihre KI zuerst sagt)',
    intro_default: 'Sie nutzen gerade die AI Talk-Testversion und können diese Nachricht bearbeiten. Die von Ihnen eingegebenen Geschäftsinformationen wurden gespeichert, und ich beantworte nur Fragen dazu. Fragen Sie mich gerne etwas.',
    edit_title: 'KI bearbeiten', edit_desc: 'Aktualisieren Sie das Wissen Ihrer KI und ihre Begrüßung.',
  },
  fr: {
    intro_label: 'Message d’accueil (ce que votre IA dit en premier)',
    intro_default: 'Vous utilisez actuellement la version d’essai d’AI Talk et vous pouvez modifier ce message. Les informations sur votre entreprise que vous avez saisies ont été enregistrées, et je réponds uniquement aux questions à ce sujet. N’hésitez pas à me poser vos questions.',
    edit_title: 'Modifier votre IA', edit_desc: 'Mettez à jour les connaissances de votre IA et son accueil.',
  },
  es: {
    intro_label: 'Mensaje de bienvenida (lo primero que dice tu IA)',
    intro_default: 'Estás usando la versión de prueba de AI Talk y puedes editar este mensaje. La información de tu empresa que ingresaste se ha guardado, y solo responderé preguntas relacionadas con ella. Pregúntame lo que quieras.',
    edit_title: 'Editar tu IA', edit_desc: 'Actualiza lo que sabe tu IA y cómo saluda.',
  },
  ko: {
    intro_label: '인트로 메시지 (AI가 처음 하는 말)',
    intro_default: '현재 AI Talk 트라이얼을 이용 중이며, 이 메시지는 수정할 수 있습니다. 입력하신 비즈니스 정보가 저장되었고, 이와 관련된 질문에만 답변드립니다. 궁금한 점을 물어보세요.',
    edit_title: 'AI 수정', edit_desc: 'AI가 아는 내용과 첫 인사를 수정합니다.',
  },
} as const

const LANG_LOCALE: Record<string, string> = {
  en: 'en-US', de: 'de-DE', 'de-ch': 'de-CH', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR',
}

function pickStrings(lang: string) {
  const key = (lang === 'de-ch' ? 'de' : lang) as keyof typeof STRINGS
  const ekey = (lang === 'de-ch' ? 'de' : lang) as keyof typeof EXTRA
  return { ...(STRINGS[key] || STRINGS.en), ...(EXTRA[ekey] || EXTRA.en) }
}

export function OnboardingModal() {
  const { currentLanguage } = useLanguage()
  const L = pickStrings(currentLanguage)
  const [step, setStep] = useState<Step>('loading')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [canVoice, setCanVoice] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ragSaved, setRagSaved] = useState(false)

  const [mode, setMode] = useState<'onboarding' | 'edit'>('onboarding')
  const [address, setAddress] = useState('')
  const [services, setServices] = useState('')
  const [hours, setHours] = useState('')
  const [holidays, setHolidays] = useState('')
  const [other, setOther] = useState('')
  const [intro, setIntro] = useState('')
  const [existingBizIds, setExistingBizIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/onboarding')
        if (!res.ok) { if (!cancelled) setStep('hidden'); return }
        const data = await res.json()
        if (cancelled) return
        setAgentId(data.agentId ?? null)
        setCanVoice(data.canVoice === true)
        if (data.completed) { setStep('hidden'); return }
        setIntro(L.intro_default)
        setStep(data.accountType ? 'ask' : 'account_type')
      } catch {
        if (!cancelled) setStep('hidden')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openEditRef = useRef<() => void>(() => {})
  useEffect(() => {
    const open = () => { openEditRef.current() }
    window.addEventListener('open-ai-setup', open)
    return () => window.removeEventListener('open-ai-setup', open)
  }, [])

  const openEditMode = async () => {
    setError(''); setRagSaved(false); setSaving(false)
    setMode('edit'); setStep('loading')
    try {
      const ob = await fetch('/api/onboarding').then((r) => r.ok ? r.json() : null)
      const aid = ob?.agentId ?? null
      setAgentId(aid)
      setCanVoice(ob?.canVoice === true)
      setIntro((ob?.greeting && String(ob.greeting).trim()) || L.intro_default)
      const p = ob?.profile || null
      let bizContent = ''
      if (aid) {
        const st = await fetch(`/api/storage?agentId=${aid}&limit=200`).then((r) => r.ok ? r.json() : null)
        const items: any[] = st?.data?.items || []
        const biz = items.filter((it) => it?.title === 'Business Information.txt')
        setExistingBizIds(biz.map((it) => String(it.id)))
        bizContent = biz[0]?.content ? String(biz[0].content) : ''
      } else {
        setExistingBizIds([])
      }
      setAddress(p?.address || '')
      setServices(p?.services || '')
      setHours(p?.hours || '')
      setHolidays(p?.holidays || '')
      setOther(p?.other || (!p ? bizContent : ''))
      setStep('form')
    } catch {
      setError(L.error_save); setStep('form')
    }
  }
  openEditRef.current = openEditMode

  const markComplete = async (profile?: Record<string, string>): Promise<boolean> => {
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile ? { profile } : {}),
      })
      return res.ok
    } catch {
      return false
    }
  }

  const chooseAccountType = async (accountType: AccountType) => {
    setError(''); setSaving(true)
    try {
      const res = await fetch('/api/onboarding/account-type', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType }),
      })
      if (!res.ok) { setError(L.error_save); setSaving(false); return }
      setSaving(false); setStep('ask')
    } catch {
      setError(L.error_save); setSaving(false)
    }
  }

  const handleLater = () => {
    setStep('hidden')
  }

  const composeContent = () => {
    const lines: string[] = []
    if (address.trim()) lines.push(`${L.q_address}: ${address.trim()}`)
    if (services.trim()) lines.push(`${L.q_services}: ${services.trim()}`)
    if (hours.trim()) lines.push(`${L.q_hours}: ${hours.trim()}`)
    if (holidays.trim()) lines.push(`${L.q_holidays}: ${holidays.trim()}`)
    if (other.trim()) lines.push(`${L.q_other}: ${other.trim()}`)
    return lines.join('\n\n')
  }

  const saveIntro = async (): Promise<boolean> => {
    const g = intro.trim()
    if (!g) return true
    try {
      const res = await fetch('/api/onboarding/intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ greeting: g, language: LANG_LOCALE[currentLanguage] || undefined }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  const handleSubmit = async () => {
    setError('')
    let aid = agentId
    if (!aid) {
      const re = await fetch('/api/onboarding').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      aid = re?.agentId ?? null
      if (aid) setAgentId(aid)
    }
    if (!aid) { setError(L.error_no_agent); return }
    const content = composeContent()
    if (new TextEncoder().encode(content).length < 20) { setError(L.error_empty); return }
    setSaving(true)
    try {
      if (!ragSaved) {
        const res = await fetch('/api/storage/create-text', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: aid, title: 'Business Information', content }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data?.error || L.error_save); setSaving(false); return
        }
        setRagSaved(true)
        if (mode === 'edit') {
          for (const id of existingBizIds) {
            await fetch(`/api/storage/items/${id}?agentId=${encodeURIComponent(aid)}`, { method: 'DELETE' }).catch(() => {})
          }
          setExistingBizIds([])
        }
      }
      await saveIntro()
      const profile = { address: address.trim(), services: services.trim(), hours: hours.trim(), holidays: holidays.trim(), other: other.trim() }
      if (!(await markComplete(profile))) { setError(L.error_finish); setSaving(false); return }
      setStep('done')
    } catch {
      setError(L.error_save); setSaving(false)
    }
  }

  if (step === 'loading' || step === 'hidden') return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin">
        {step === 'account_type' && (
          <>
            <CardHeader>
              <CardTitle>{L.acct_title}</CardTitle>
              <CardDescription>{L.acct_desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button onClick={() => chooseAccountType('company')} disabled={saving}>{L.acct_company}</Button>
              <Button variant="outline" onClick={() => chooseAccountType('individual')} disabled={saving}>{L.acct_individual}</Button>
            </CardContent>
          </>
        )}

        {step === 'ask' && (
          <>
            <CardHeader>
              <CardTitle>{L.title}</CardTitle>
              <CardDescription>{L.ask_desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button onClick={() => setStep('form')}>{L.ask_yes}</Button>
              <Button variant="ghost" onClick={handleLater} disabled={saving}>{L.ask_later}</Button>
            </CardContent>
          </>
        )}

        {step === 'form' && (
          <>
            <CardHeader>
              <CardTitle>{mode === 'edit' ? L.edit_title : L.form_title}</CardTitle>
              <CardDescription>{mode === 'edit' ? L.edit_desc : L.form_desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="space-y-1">
                <Label htmlFor="ob-intro">{L.intro_label}</Label>
                <Textarea id="ob-intro" rows={2} maxLength={500} value={intro} onChange={(e) => setIntro(e.target.value)} disabled={saving} />
              </div>

              <div className="space-y-1">
                <Label htmlFor="ob-address">{L.q_address}</Label>
                <Textarea id="ob-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-services">{L.q_services}</Label>
                <Textarea id="ob-services" rows={2} value={services} onChange={(e) => setServices(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-hours">{L.q_hours}</Label>
                <Textarea id="ob-hours" rows={2} value={hours} onChange={(e) => setHours(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-holidays">{L.q_holidays}</Label>
                <Textarea id="ob-holidays" rows={2} value={holidays} onChange={(e) => setHolidays(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-other">{L.q_other}</Label>
                <Textarea id="ob-other" rows={2} value={other} onChange={(e) => setOther(e.target.value)} disabled={saving} />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSubmit} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {L.submit}
                </Button>
                <Button variant="ghost" onClick={handleLater} disabled={saving}>{L.ask_later}</Button>
              </div>
            </CardContent>
          </>
        )}

        {step === 'done' && (
          <>
            <CardHeader className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
              <CardTitle>{L.done_title}</CardTitle>
              <CardDescription>{L.done_desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {agentId && canVoice && (
                <Button
                  className="w-full"
                  onClick={() => window.open(`/voice/${agentId}`, 'aitalk-voice', 'width=420,height=680')}
                >
                  {L.done_call}
                </Button>
              )}
              <Button className="w-full" variant="outline" onClick={() => setStep('hidden')}>{L.done_cta}</Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}

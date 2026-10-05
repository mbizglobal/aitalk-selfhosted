'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

const DEEPLINK = 'aitalk://verified'
const WEB_FALLBACK = '/app'

const L = {
  en: { opening: 'Opening the AiTalk app…', hint: "If the app doesn't open, sign in from the app, or continue on the web.", openBtn: 'Open the app', webBtn: 'Continue on the web' },
  de: { opening: 'AiTalk-App wird geöffnet…', hint: 'Falls die App nicht öffnet, melden Sie sich in der App an oder fahren Sie im Web fort.', openBtn: 'App öffnen', webBtn: 'Im Web fortfahren' },
  fr: { opening: "Ouverture de l'application AiTalk…", hint: "Si l'application ne s'ouvre pas, connectez-vous depuis l'application ou continuez sur le web.", openBtn: "Ouvrir l'application", webBtn: 'Continuer sur le web' },
  es: { opening: 'Abriendo la aplicación AiTalk…', hint: 'Si la aplicación no se abre, inicia sesión desde la aplicación o continúa en la web.', openBtn: 'Abrir la aplicación', webBtn: 'Continuar en la web' },
  ko: { opening: 'AiTalk 앱을 여는 중…', hint: '앱이 열리지 않으면 앱에서 로그인하거나 웹으로 계속하세요.', openBtn: '앱 열기', webBtn: '웹으로 계속' },
} as const

function OpenAppContent() {
  const searchParams = useSearchParams()
  const langParam = searchParams.get('lang')
  const lang = (['en', 'de', 'fr', 'es', 'ko'].includes(langParam || '') ? langParam : 'en') as keyof typeof L
  const m = L[lang]

  useEffect(() => {
    const t = setTimeout(() => { window.location.href = DEEPLINK }, 200)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
              <span className="text-xl font-bold text-primary-foreground">AI</span>
            </div>
          </div>
          <CardTitle className="text-xl text-center">{m.opening}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground text-center">{m.hint}</p>
          <div className="space-y-2">
            <Button onClick={() => { window.location.href = DEEPLINK }} className="w-full">
              {m.openBtn}
            </Button>
            <Button asChild variant="outline" className="w-full">
              <a href={WEB_FALLBACK}>{m.webBtn}</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function OpenAppPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl text-center">Loading…</CardTitle>
          </CardHeader>
        </Card>
      </div>
    }>
      <OpenAppContent />
    </Suspense>
  )
}

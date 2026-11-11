import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { defaultWorkSheetDeps } from '@/lib/work/sheet-gate'
import { resolveIntakePage } from '@/lib/work/intake-form'
import { describeCaughtError } from '@/lib/log-mask'
import { IntakeFormClient } from './intake-form-client'
import { INTAKE_TEXT, pickIntakeLang } from './intake-text'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Request', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const lang = pickIntakeLang((await headers()).get('accept-language'))
  const t = INTAKE_TEXT[lang]
  let page: Awaited<ReturnType<typeof resolveIntakePage>> = null
  try {
    page = await resolveIntakePage(await defaultWorkSheetDeps(), token)
  } catch (e) {
    console.error('[public-intake] 화면:', describeCaughtError(e))
  }
  if (!page) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4" lang={lang}>
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <h1 className="text-lg font-semibold text-gray-900">{t.notFoundTitle}</h1>
          <p className="mt-2 text-sm text-gray-600">{t.notFound}</p>
        </div>
      </main>
    )
  }
  return (
    <main className="min-h-screen bg-gray-50 flex justify-center p-4 sm:p-8" lang={lang}>
      <IntakeFormClient token={token} lang={lang} app={page.app} table={page.table} columns={page.columns} opened={page.opened} />
    </main>
  )
}

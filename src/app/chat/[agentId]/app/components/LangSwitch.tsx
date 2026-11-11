'use client'

import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Globe } from 'lucide-react'
import type { WorkLang } from '@/lib/translations/work'

const LANGS: ReadonlyArray<{ code: WorkLang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'ko', label: '한국어' },
]

export function LangSwitch({ lang, title }: { lang: WorkLang; title: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const change = (next: WorkLang) => {
    const q = new URLSearchParams(search.toString())
    q.set('lang', next)
    router.replace(`${pathname}?${q.toString()}`, { scroll: false })
  }
  return (
    <label className="relative flex items-center gap-1 shrink-0 px-1 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-[#232323] cursor-pointer" title={title}>
      <Globe className="w-3.5 h-3.5" />
      <span className="uppercase">{lang}</span>
      <select value={lang} onChange={(e) => change(e.target.value as WorkLang)} aria-label={title} className="absolute inset-0 opacity-0 cursor-pointer">
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  )
}

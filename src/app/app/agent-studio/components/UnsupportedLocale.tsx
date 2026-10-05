'use client'

import { SelectItem } from '@/components/ui/select'
import { isVoiceLocale } from '@/lib/call/voice-locales'

export function isUnsupportedLocaleValue(
  value: string | undefined | null,
  options: ReadonlyArray<{ value: string }>,
): boolean {
  const v = (value ?? '').trim()
  if (v === '') return false
  return !options.some((o) => o.value === v)
}

export function UnsupportedLocaleItem({ value }: { value: string }) {
  return (
    <SelectItem key={value} value={value} disabled>
      {value}
    </SelectItem>
  )
}

export function UnsupportedLocaleNotice({ text }: { text: string }) {
  return <p className="text-[11px] text-amber-400 mt-1 leading-snug">{text}</p>
}

export function MenuLocaleChip({
  locale, label, index, supported, notInCallText, emptyLabel,
}: {
  locale: string
  label: string
  index: number
  supported: boolean
  notInCallText: string
  emptyLabel: string
}) {
  return (
    <span
      title={supported ? undefined : notInCallText}
      className={
        supported
          ? 'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded bg-[#1a1a28] border border-gray-700 text-gray-300'
          : 'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded bg-[#2a1f14] border border-amber-700/60 text-amber-300'
      }
    >
      <span
        className={
          supported
            ? 'inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white text-[9px] font-semibold'
            : 'inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-700 text-white text-[9px] font-semibold'
        }
      >
        {supported ? index : '!'}
      </span>
      {label || locale || emptyLabel}
    </span>
  )
}

export function isUsableCallLocale(locale: unknown): boolean {
  return isVoiceLocale(locale)
}

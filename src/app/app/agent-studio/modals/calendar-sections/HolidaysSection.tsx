'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CalendarOff, Plus, Trash2, RotateCcw, Download, AlertTriangle } from 'lucide-react'
import type { HolidayEntry } from '@/lib/holidays/closed-day-status'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { getSubdivisionName } from '@/lib/holidays/subdivision-names'

interface Props {
  holidays: Holiday[]
  onChange: (next: Holiday[]) => void
  onReset: () => void
  maxHolidays: number
  todayIso?: string
  lockedCountry?: string
  showHeader?: boolean
  emptyText?: string
}

type Holiday = HolidayEntry

interface CountryOpt {
  code: string
  name: string
  hasSubdivisions: boolean
}
interface SubdivisionOpt {
  code: string
  name: string
}

const MAX_DAYS_AHEAD = 730

function browserTodayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00Z`)
  if (!Number.isFinite(base.getTime())) return ymd
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

export function HolidaysSection({
  holidays: holidaysRaw,
  onChange,
  onReset,
  maxHolidays,
  todayIso: todayIsoProp,
  lockedCountry,
  showHeader = true,
  emptyText,
}: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const holidays: Holiday[] = useMemo(
    () => (holidaysRaw ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)),
    [holidaysRaw]
  )

  const todayIso = () => todayIsoProp || browserTodayIso()
  const maxDateIso = () => addDaysIso(todayIso(), MAX_DAYS_AHEAD)

  const setHolidays = (next: Holiday[]) => {
    onChange(next)
  }

  const updateHolidayAt = (index: number, patch: Partial<Holiday>) => {
    const next = holidays.map((h, i) =>
      i === index
        ? {
            ...h,
            ...patch,
            origin: patch.origin ?? (patch.name && patch.name !== h.name ? 'manual' : h.origin),
          }
        : h
    )
    setHolidays(next)
  }

  const removeHolidayAt = (index: number) => {
    setHolidays(holidays.filter((_, i) => i !== index))
  }

  const addCustomHoliday = () => {
    if (holidays.length >= maxHolidays) return
    setHolidays([...holidays, { date: addDaysIso(todayIso(), 7), name: '', origin: 'manual' }])
  }

  // ─── Country / Subdivision / Years (Import UI) ───
  const [countries, setCountries] = useState<CountryOpt[]>([])
  const [loadingCountries, setLoadingCountries] = useState(false)
  const [countryCode, setCountryCode] = useState<string>(lockedCountry ?? '')
  const [subdivisions, setSubdivisions] = useState<SubdivisionOpt[]>([])
  const [loadingSubdivisions, setLoadingSubdivisions] = useState(false)
  const [subdivision, setSubdivision] = useState<string>('')
  const currentYear = new Date().getFullYear()
  const [selectedYears, setSelectedYears] = useState<number[]>([currentYear, currentYear + 1])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoadingCountries(true)
      try {
        const res = await fetch('/api/agent-studio/holidays/countries')
        const data = await res.json()
        if (alive && res.ok && data.success && Array.isArray(data.countries)) {
          setCountries(data.countries)
        }
      } catch {
        // silent
      } finally {
        if (alive) setLoadingCountries(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (lockedCountry) {
      setCountryCode(lockedCountry)
      setSubdivision('')
    }
  }, [lockedCountry])

  const selectedCountry = countries.find((c) => c.code === countryCode)
  useEffect(() => {
    if (!selectedCountry || !selectedCountry.hasSubdivisions) {
      setSubdivisions([])
      setSubdivision('')
      return
    }
    let alive = true
    ;(async () => {
      setLoadingSubdivisions(true)
      try {
        const res = await fetch(
          `/api/agent-studio/holidays/subdivisions?countryCode=${encodeURIComponent(countryCode)}`
        )
        const data = await res.json()
        if (alive && res.ok && data.success && Array.isArray(data.subdivisions)) {
          setSubdivisions(data.subdivisions)
        }
      } catch {
        // silent
      } finally {
        if (alive) setLoadingSubdivisions(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [countryCode, selectedCountry])

  const toggleYear = (year: number) => {
    setSelectedYears((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year].sort()
    )
  }

  const runImport = async () => {
    if (!countryCode || selectedYears.length === 0) return
    setImporting(true)
    setImportError(null)
    setImportMessage(null)
    try {
      const url = new URL('/api/agent-studio/holidays/import', window.location.origin)
      url.searchParams.set('countryCode', countryCode)
      if (subdivision) url.searchParams.set('subdivision', subdivision)
      url.searchParams.set('years', selectedYears.join(','))
      const res = await fetch(url.toString())
      const data = await res.json()
      if (!res.ok || !data.success) {
        const errMsg = data?.error || `Import failed (${res.status})`
        setImportError(
          (t.cal_adv_holidays_import_failed || 'Import failed: {error}').replace('{error}', errMsg)
        )
        return
      }
      const fetched: Array<{ date: string; name: string; subdivisions?: string[] }> = data.holidays || []

      const manualKept = holidays.filter((h) => h.origin === 'manual')
      const manualDateSet = new Set(manualKept.map((h) => h.date))
      const newAuto: Holiday[] = fetched
        .filter((f) => !manualDateSet.has(f.date))
        .map((f) => ({
          date: f.date,
          name: f.name,
          origin: 'auto' as const,
          ...(f.subdivisions && f.subdivisions.length ? { subdivisions: f.subdivisions } : {}),
        }))

      const merged = [...manualKept, ...newAuto]
        .slice(0, maxHolidays)
        .sort((a, b) => a.date.localeCompare(b.date))
      setHolidays(merged)
      setImportMessage(
        (t.cal_adv_holidays_import_done || 'Imported {count} holidays.').replace(
          '{count}',
          String(newAuto.length)
        )
      )
    } catch (err: any) {
      setImportError(
        (t.cal_adv_holidays_import_failed || 'Import failed: {error}').replace(
          '{error}',
          err?.message || 'network'
        )
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        {showHeader ? (
          <div>
            <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
              🎉 {t.cal_adv_holidays_title || 'Holidays'}
            </h3>
            <p className="text-xs text-gray-500">
              {t.cal_adv_holidays_desc ||
                'Define dates when bookings should not be accepted. Import national/regional holidays automatically, then edit as needed. Up to 2 years from today.'}
            </p>
          </div>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-amber-300 transition-colors shrink-0"
          title={t.cal_adv_reset_section_hint || 'Reset this section to defaults'}
        >
          <RotateCcw className="w-3 h-3" />
          {t.cal_adv_reset_button || 'Reset'}
        </button>
      </div>

      {/* Import controls */}
      <div className="p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {t.cal_adv_holidays_country || 'Country'}
            </label>
            <select
              value={countryCode}
              onChange={(e) => {
                setCountryCode(e.target.value)
                setSubdivision('')
                setImportError(null)
                setImportMessage(null)
              }}
              disabled={loadingCountries || !!lockedCountry}
              className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {loadingCountries
                  ? t.cal_adv_holidays_loading_countries || 'Loading countries…'
                  : '—'}
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          {selectedCountry?.hasSubdivisions && !lockedCountry && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {t.cal_adv_holidays_subdivision || 'Region / State / Canton'}
              </label>
              <select
                value={subdivision}
                onChange={(e) => setSubdivision(e.target.value)}
                disabled={loadingSubdivisions}
                className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 disabled:opacity-50"
              >
                <option value="">
                  {t.cal_adv_holidays_subdivision_none || 'National holidays only'}
                </option>
                <option value="ALL">
                  {t.cal_adv_holidays_subdivision_all || 'All regions (combined)'}
                </option>
                {subdivisions.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              {subdivision === 'ALL' && (
                <p className="text-xs text-gray-500 mt-1">
                  {t.cal_adv_holidays_subdivision_all_hint ||
                    'Imports every holiday observed in any region — useful if your patients come from multiple regions.'}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {t.cal_adv_holidays_years || 'Years'}
          </label>
          <div className="flex gap-3 flex-wrap">
            {[currentYear, currentYear + 1, currentYear + 2].map((year) => (
              <label
                key={year}
                className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={selectedYears.includes(year)}
                  onChange={() => toggleYear(year)}
                  className="w-4 h-4 accent-teal-500"
                />
                {year}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runImport}
            disabled={!countryCode || selectedYears.length === 0 || importing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-teal-700 bg-teal-900/30 text-teal-200 hover:bg-teal-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {importing
              ? t.cal_adv_holidays_import_loading || 'Loading…'
              : t.cal_adv_holidays_import_btn || 'Import holidays'}
          </button>
          {importMessage && <span className="text-xs text-emerald-400">{importMessage}</span>}
        </div>

        {importError && (
          <div className="flex items-start gap-2 p-2 rounded border border-red-800/40 bg-red-900/10">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{importError}</p>
          </div>
        )}

        <p className="text-xs text-gray-500">
          ⚠ {t.cal_adv_holidays_replace_warning ||
            'Importing replaces previously imported entries. Manual entries are preserved.'}
        </p>
      </div>

      {/* Holidays list */}
      {holidays.length === 0 && (
        <div className="p-6 rounded border border-dashed border-[#3A3A3A] bg-[#1a1a1a] text-center">
          <CalendarOff className="w-6 h-6 text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400 mb-3">
            {emptyText ||
              t.cal_adv_holidays_empty ||
              'No holidays defined — bookings are accepted year-round (subject to weekly closed days).'}
          </p>
          <button
            type="button"
            onClick={addCustomHoliday}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-teal-700 bg-teal-900/20 text-teal-300 hover:bg-teal-900/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.cal_adv_holidays_add_custom || 'Add custom holiday'}
          </button>
        </div>
      )}

      {holidays.length > 0 && (
        <div className="space-y-2">
          {holidays.map((h, i) => {
            const dateOk =
              /^\d{4}-\d{2}-\d{2}$/.test(h.date) &&
              h.date >= todayIso() &&
              h.date <= maxDateIso()
            return (
              <div
                key={`${h.date}-${i}`}
                className="p-2 rounded border border-[#3A3A3A] bg-[#1a1a1a] flex items-center gap-2"
              >
                <input
                  type="date"
                  value={h.date}
                  min={todayIso()}
                  max={maxDateIso()}
                  onChange={(e) => {
                    const newDate = e.target.value
                    if (!newDate || newDate === h.date) return
                    updateHolidayAt(i, { date: newDate, origin: 'manual' })
                  }}
                  className={`bg-[#1e1e2e] border rounded px-2 py-1 text-xs text-gray-200 w-32 ${
                    dateOk ? 'border-gray-700' : 'border-red-700'
                  }`}
                />
                <input
                  type="text"
                  value={h.name}
                  onChange={(e) => updateHolidayAt(i, { name: e.target.value })}
                  placeholder={t.cal_adv_holidays_name_label || 'Holiday name'}
                  className="flex-1 min-w-0 bg-[#1e1e2e] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600"
                />
                {h.subdivisions && h.subdivisions.length > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300 max-w-[180px] truncate"
                    title={h.subdivisions
                      .map((c) => `${getSubdivisionName(c)} (${c})`)
                      .join(', ')}
                  >
                    {h.subdivisions.length === 1
                      ? getSubdivisionName(h.subdivisions[0])
                      : `${h.subdivisions.length} ${t.cal_adv_holidays_subdivision_count_label || 'regions'}`}
                  </span>
                )}
                {(!h.subdivisions || h.subdivisions.length === 0) && h.origin === 'auto' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300">
                    {t.cal_adv_holidays_subdivision_national_label || 'national'}
                  </span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    h.origin === 'manual'
                      ? 'bg-amber-900/30 text-amber-300'
                      : 'bg-blue-900/30 text-blue-300'
                  }`}
                >
                  {h.origin === 'manual'
                    ? t.cal_adv_holidays_origin_manual || 'manual'
                    : t.cal_adv_holidays_origin_auto || 'auto'}
                </span>
                <button
                  type="button"
                  onClick={() => removeHolidayAt(i)}
                  className="text-gray-500 hover:text-red-400 transition-colors p-1"
                  title={t.cal_adv_holidays_remove || 'Remove'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}

          {holidays.length < maxHolidays ? (
            <button
              type="button"
              onClick={addCustomHoliday}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded border border-dashed border-[#3A3A3A] text-gray-400 hover:border-teal-700 hover:text-teal-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t.cal_adv_holidays_add_custom || 'Add custom holiday'}
            </button>
          ) : (
            <p className="text-xs text-gray-500 text-center">
              {(t.cal_adv_holidays_max_reached || 'Maximum {max} holidays reached.').replace(
                '{max}',
                String(maxHolidays)
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

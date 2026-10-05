'use client'

import React from 'react'
import { RotateCcw, Users, Plus, X } from 'lucide-react'
import { HelpDot } from '../../components/HelpDot'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

type CapacityMode = 'single' | 'simple' | 'tables'

interface TableType {
  id: string
  name: string
  capacity: number
  count: number
}

const MEAL_DURATION_OPTIONS = [45, 60, 75, 90, 105, 120, 150, 180]
const TABLE_FIELD_MAX = 50
const RESERVATION_GRID_OPTIONS = [5, 10, 15, 20, 30]
const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120]
const CLEANUP_OPTIONS = [0, 5, 10, 15, 20, 30]
function withValue(options: number[], v: number): number[] {
  return options.includes(v) ? options : [...options, v].sort((a, b) => a - b)
}

function makeId(): string {
  return 'tbl_' + Math.random().toString(36).slice(2, 10)
}

export function CapacitySection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const mode: CapacityMode = (draft.capacityMode as CapacityMode) || 'single'
  const simpleCapacity = typeof draft.simpleCapacity === 'number' ? draft.simpleCapacity : 1
  const tableInventory: TableType[] = Array.isArray(draft.tableInventory) ? (draft.tableInventory as TableType[]) : []
  const defaultDurationMin = typeof draft.defaultDurationMin === 'number' ? draft.defaultDurationMin : 30
  const cleanupMin = typeof draft.cleanupMin === 'number' ? draft.cleanupMin : 0
  const rawDefaultDurationMin = typeof draft.defaultDurationMin === 'number' && draft.defaultDurationMin > 0 ? draft.defaultDurationMin : undefined
  const mealDurationMin = typeof draft.mealDurationMin === 'number' && draft.mealDurationMin > 0 ? draft.mealDurationMin : (rawDefaultDurationMin ?? 90)
  const reservationGridMin = typeof draft.reservationGridMin === 'number' ? draft.reservationGridMin : 15
  const slotIntervalMin = Math.max(5, (defaultDurationMin || 30) + (cleanupMin || 0))
  const fmt = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
  const tableMatchPolicy = 'smallest_fit' as const

  const setMode = (next: CapacityMode) => {
    if (next === 'single') {
      update({ capacityMode: 'single' })
    } else if (next === 'simple') {
      update({ capacityMode: 'simple', simpleCapacity: simpleCapacity || 10 })
    } else {
      update({
        capacityMode: 'tables',
        tableInventory: tableInventory.length > 0 ? tableInventory : [
          { id: makeId(), name: t.cal_adv_cap_table_4 || '4-seat table', capacity: 4, count: 8 },
        ],
        mealDurationMin: mealDurationMin || 90,
        reservationGridMin: reservationGridMin || 15,
        tableMatchPolicy: tableMatchPolicy || 'smallest_fit',
      })
    }
  }

  const addTable = () => {
    const next = [...tableInventory, { id: makeId(), name: '', capacity: 4, count: 1 }]
    update({ tableInventory: next })
  }
  const removeTable = (id: string) => {
    update({ tableInventory: tableInventory.filter((t) => t.id !== id) })
  }
  const updateTable = (id: string, patch: Partial<TableType>) => {
    update({ tableInventory: tableInventory.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            <Users className="w-4 h-4" />
            {t.cal_adv_capacity_title || 'Capacity'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_capacity_desc ||
              'How many bookings can be accepted at the same time. Default: one customer per slot (clinics, 1-person salons). Restaurants and group classes need higher capacity.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-amber-300 transition-colors shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
          {t.cal_adv_reset_button || 'Reset'}
        </button>
      </div>

      <div className="space-y-2">
        <ModeRadio
          checked={mode === 'single'}
          onClick={() => setMode('single')}
          label={t.cal_adv_cap_mode_single || 'Sequential — one customer per slot'}
          hint={t.cal_adv_cap_mode_single_hint || 'Clinic, 1-person hairdresser, lawyer consultation, etc.'}
        />
        <ModeRadio
          checked={mode === 'simple'}
          onClick={() => setMode('simple')}
          label={t.cal_adv_cap_mode_simple || 'Concurrent — N customers at the same time'}
          hint={t.cal_adv_cap_mode_simple_hint || 'Yoga class, massage shop, simple seat-pool restaurant. AI auto-asks "How many people?".'}
        />
        <ModeRadio
          checked={mode === 'tables'}
          onClick={() => setMode('tables')}
          label={t.cal_adv_cap_mode_tables || 'Table inventory (restaurant)'}
          hint={t.cal_adv_cap_mode_tables_hint || 'Restaurant — 4-top, 6-top, 10-top tables. AI auto-assigns the smallest fitting table.'}
        />
      </div>

      {mode === 'simple' && (
        <div className="border border-[#3A3A3A] rounded-lg p-4 bg-[#1e1e2e] space-y-3">
          <label className="block text-sm font-medium text-gray-200">
            {t.cal_adv_cap_simple_label || 'Capacity (total people at the same time)'}
          </label>
          <input
            type="number"
            min={2}
            max={999}
            value={simpleCapacity}
            onChange={(e) => update({ simpleCapacity: Math.max(1, Math.min(999, parseInt(e.target.value) || 1)) })}
            className="w-32 bg-[#0F0F0F] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          />
          <p className="text-xs text-gray-500 leading-relaxed">
            {t.cal_adv_cap_simple_hint ||
              'Party sizes are summed. 4 people + 2 people = 6 used. When full, AI proposes another time. Examples: yoga 10–20, massage shop 3–8, small restaurant 30–60.'}
          </p>
        </div>
      )}

      {mode !== 'tables' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                {t.cal_adv_cap_duration || 'Duration'}
                <HelpDot glyph="?" size="md" text={(mode === 'simple' ? `${t.cal_adv_cap_duration_help || 'How long one booking takes. This is the default; the AI may pass a different length when the caller asks for one.'} ${t.cal_adv_cap_concurrent_interval_note || 'Even when seats remain, the next start is one interval later — bookings run in fixed rounds.'}` : (t.cal_adv_cap_duration_help || 'How long one booking takes. This is the default; the AI may pass a different length when the caller asks for one.'))} />
              </label>
              <select
                value={defaultDurationMin}
                onChange={(e) => update({ defaultDurationMin: Number(e.target.value) })}
                className="w-full bg-[#0F0F0F] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
              >
                {withValue(DURATION_OPTIONS, defaultDurationMin).map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                {t.cal_adv_cap_cleanup || 'Cleanup time'}
                <HelpDot glyph="?" size="md" text={t.cal_adv_cap_cleanup_help || 'Gap after each booking before the next may start — added on top of the duration, not included in it.'} />
              </label>
              <select
                value={cleanupMin}
                onChange={(e) => update({ cleanupMin: Number(e.target.value) })}
                className="w-full bg-[#0F0F0F] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
              >
                {withValue(CLEANUP_OPTIONS, cleanupMin).map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {fmt(t.cal_adv_cap_interval_line || 'Start times every {n} min', { n: slotIntervalMin })}
            {' · '}
            {cleanupMin > 0
              ? fmt(t.cal_adv_cap_interval_detail || '{d} min + {c} min cleanup', { d: defaultDurationMin, c: cleanupMin })
              : (t.cal_adv_cap_interval_no_cleanup || 'no cleanup gap')}
          </p>
        </div>
      )}

      {mode === 'tables' && (
        <div className="border border-[#3A3A3A] rounded-lg p-4 bg-[#1e1e2e] space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-200">
                {t.cal_adv_cap_inventory_label || 'Table Inventory'}
              </label>
              <button
                type="button"
                onClick={addTable}
                disabled={tableInventory.length >= 8}
                className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:text-gray-600 disabled:cursor-not-allowed"
              >
                <Plus className="w-3 h-3" />
                {t.cal_adv_cap_inventory_add || 'Add table type'}
              </button>
            </div>
            {tableInventory.length === 0 && (
              <p className="text-xs text-gray-500 italic">
                {t.cal_adv_cap_inventory_empty || 'No table types — click Add to define one.'}
              </p>
            )}
            <div className="space-y-2">
              {tableInventory.map((tt) => (
                <div key={tt.id} className="flex items-center gap-2 bg-[#0F0F0F] border border-gray-700 rounded p-2">
                  <input
                    type="text"
                    value={tt.name}
                    onChange={(e) => updateTable(tt.id, { name: e.target.value })}
                    placeholder={t.cal_adv_cap_table_name_placeholder || 'e.g. 4-seat table'}
                    className="flex-1 bg-transparent text-sm text-gray-200 px-2 py-1 outline-none"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={tt.capacity}
                      onChange={(e) => updateTable(tt.id, { capacity: Math.min(TABLE_FIELD_MAX, Math.max(1, parseInt(e.target.value) || 1)) })}
                      className="w-14 bg-[#1e1e2e] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 text-center"
                    />
                    <span className="text-xs text-gray-500">{t.cal_adv_cap_seats || 'seats'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">×</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={tt.count}
                      onChange={(e) => updateTable(tt.id, { count: Math.min(TABLE_FIELD_MAX, Math.max(1, parseInt(e.target.value) || 1)) })}
                      className="w-14 bg-[#1e1e2e] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 text-center"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTable(tt.id)}
                    className="text-gray-500 hover:text-red-400 p-1"
                    aria-label="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {tableInventory.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {t.cal_adv_cap_table_name_spoken_hint ||
                  'The table name is read to the caller when a booking is confirmed (e.g. "a 4-seat table for 4 people").'}
              </p>
            )}
          </div>

          {/* Meal duration + Reservation grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                {t.cal_adv_cap_meal_duration || 'Meal Duration (table occupied for)'}
                <HelpDot glyph="?" size="md" text={t.cal_adv_cap_meal_duration_help || 'How long one booking keeps its table — including the time to clear and reset it. 60 min: a table booked at 18:00 is offered again at 19:00. If staff need time to reset the table, add it here (e.g. 45 min meal + 15 min reset = 60 min).'} />
              </label>
              <select
                value={mealDurationMin}
                onChange={(e) => update({ mealDurationMin: Number(e.target.value) })}
                className="w-full bg-[#0F0F0F] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
              >
                {withValue(MEAL_DURATION_OPTIONS, mealDurationMin).map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                {t.cal_adv_cap_reservation_grid || 'Booking start times'}
                <HelpDot glyph="?" size="md" text={t.cal_adv_cap_reservation_grid_help || 'How often a booking may start. 30 min: 18:00, 18:30, 19:00 … Each table stays occupied for the meal duration, so a table that frees up at 19:00 is offered again at 19:00.'} />
              </label>
              <select
                value={reservationGridMin}
                onChange={(e) => update({ reservationGridMin: Number(e.target.value) })}
                className="w-full bg-[#0F0F0F] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
              >
                {withValue(RESERVATION_GRID_OPTIONS, reservationGridMin).map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded border border-blue-800/40 bg-blue-900/10">
            <Users className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-300 leading-relaxed">
              {t.cal_adv_cap_tables_note ||
                'The AI seats each party at the smallest table that fits (4 people → 4-seat table, 5 people → 6-seat table). When no fitting table is free at the requested time, it offers another time. A group larger than your biggest table cannot be booked at any time — the AI asks them to contact you directly.'}
            </p>
          </div>
        </div>
      )}

      {mode !== 'single' && (
        <div className="flex items-start gap-2 p-3 rounded border border-emerald-800/40 bg-emerald-900/10">
          <Users className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-300 leading-relaxed">
            {mode === 'simple'
              ? (t.cal_adv_cap_simple_active || `Active — AI auto-asks party size and tracks against capacity ${simpleCapacity}.`)
              : (t.cal_adv_cap_tables_active || 'Active — AI auto-asks party size and assigns a table from the inventory.')}
          </p>
        </div>
      )}
    </div>
  )
}

function ModeRadio({ checked, onClick, label, hint }: { checked: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        checked
          ? 'border-emerald-500/60 bg-emerald-500/10'
          : 'border-[#3A3A3A] bg-[#1e1e2e] hover:border-gray-500'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-3 h-3 rounded-full border-2 ${checked ? 'border-emerald-400 bg-emerald-400' : 'border-gray-500'}`} />
        <span className="text-sm font-medium text-gray-200">{label}</span>
      </div>
      <p className="text-xs text-gray-500 ml-5 leading-relaxed">{hint}</p>
    </button>
  )
}

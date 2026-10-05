
import { descriptionText, findPartySize, isFreeEvent, eventRangeMs, computeSeatUsage, type CalendarEventLike } from './capacity'

const TABLE_LINE_REGEX = /^\s*table\s*[:：]\s*(.+?)\s+#\s*(\d{1,4})(?:\s*\[([A-Za-z0-9_-]{1,64})\])?\s*$/im
const TABLE_LABEL_REGEX = /^\s*table\s*[:：]/i
const TABLE_SHAPE_REGEX = /^\s*table\s*[:：]\s*.+?\s+#\s*\d{1,4}(?:\s*\[[A-Za-z0-9_-]{1,64}\])?\s*$/i

export const TABLE_CAPACITY_MAX = 50
export const TABLE_COUNT_MAX = 50
const PARTY_LABEL_REGEX = /^\s*party\s*[:：]/i
const META_END_REGEX = /^\s*(notes|source)\s*[:：]/i

export interface TableType {
  id: string
  name: string
  capacity: number
  count: number
}

export type TableEvent = CalendarEventLike

export interface TableAssignment {
  tableId: string
  tableName: string
  instanceIdx: number
}

export type TableMatchPolicy = 'smallest_fit' | 'exact_only'

function lineSafeTableId(raw: string): string {
  const id = raw.trim()
  if (!id) return ''
  if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) return id
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `x${h.toString(36)}`
}

export function normalizeTableInventory(raw: unknown): TableType[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TableType[] = []
  for (const t of raw as Array<Record<string, unknown> | null>) {
    if (!t || typeof t !== 'object') continue
    const id = typeof t.id === 'string' || typeof t.id === 'number' ? lineSafeTableId(String(t.id)) : ''
    const cap = Number(t.capacity)
    const cnt = Number(t.count)
    if (!id || seen.has(id) || !Number.isFinite(cap) || cap < 1 || !Number.isFinite(cnt) || cnt < 1) continue
    seen.add(id)
    const capacity = Math.min(TABLE_CAPACITY_MAX, Math.floor(cap))
    const name = typeof t.name === 'string' ? t.name.replace(/[\r\n\u2028\u2029]+/g, ' ').trim() : ''
    out.push({ id, name, capacity, count: Math.min(TABLE_COUNT_MAX, Math.floor(cnt)) })
  }
  const used = new Set(out.map((t) => t.name).filter(Boolean))
  for (const t of out) {
    if (t.name) continue
    const base = `${t.capacity}-seat table`
    let name = base
    for (let k = 2; used.has(name); k++) name = `${base} ${k}`
    used.add(name)
    t.name = name
  }
  return out
}

export function parseTableAssignment(
  description: string | null | undefined,
  inventory: TableType[]
): TableAssignment | null {
  if (!description) return null
  const m = descriptionText(description).match(TABLE_LINE_REGEX)
  if (!m) return null
  const tableName = m[1].trim()
  const instanceIdx = parseInt(m[2], 10)
  const tableId = m[3]
  if (!Number.isFinite(instanceIdx) || instanceIdx < 1) return null

  const lower = tableName.toLowerCase()
  const tt = tableId
    ? inventory.find((t) => t.id === tableId)
    : inventory.find((t) => t.name.trim().toLowerCase() === lower)
  if (!tt) return null
  if (instanceIdx > tt.count) return null
  return { tableId: tt.id, tableName: tt.name, instanceIdx }
}

function tableFromEvent(ev: TableEvent, inventory: TableType[]): TableAssignment | null {
  return (
    parseTableAssignment(ev?.description, inventory) ||
    parseTableAssignment(ev?.body?.content, inventory)
  )
}

export function computeTableOccupancy(
  events: TableEvent[],
  inventory: TableType[],
  newStartMs: number,
  newEndMs: number,
  timezone: string
): { occupied: Map<string, Set<number>>; blocked: boolean } {
  const busy = new Map<string, Array<{ s: number; e: number }>>()
  const occupied = new Map<string, Set<number>>()
  const add = (tableId: string, instanceIdx: number, r: { s: number; e: number }) => {
    const key = `${tableId}#${instanceIdx}`
    busy.set(key, [...(busy.get(key) || []), r])
    let set = occupied.get(tableId)
    if (!set) {
      set = new Set()
      occupied.set(tableId, set)
    }
    set.add(instanceIdx)
  }
  const partyOnly: Array<{ r: { s: number; e: number }; party: number | null }> = []
  for (const ev of events) {
    if (isFreeEvent(ev)) continue
    const r = eventRangeMs(ev, timezone)
    if (!r || r.s >= newEndMs || r.e <= newStartMs) continue
    const a = tableFromEvent(ev, inventory)
    if (a) add(a.tableId, a.instanceIdx, r)
    else partyOnly.push({ r, party: findPartySize(ev?.description) ?? findPartySize(ev?.body?.content) })
  }
  const fits = (party: number) =>
    inventory
      .filter((t) => t.capacity >= party && t.count > 0)
      .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name))
  let blocked = false
  for (const p of partyOnly.sort((x, y) => x.r.s - y.r.s)) {
    let placed = false
    if (p.party != null) {
      for (const tt of fits(p.party)) {
        for (let i = 1; i <= tt.count && !placed; i++) {
          const clash = (busy.get(`${tt.id}#${i}`) || []).some((b) => b.s < p.r.e && b.e > p.r.s)
          if (!clash) {
            add(tt.id, i, p.r)
            placed = true
          }
        }
        if (placed) break
      }
    }
    if (!placed) blocked = true
  }
  return { occupied, blocked }
}

export function assignTable(
  inventory: TableType[],
  occupied: Map<string, Set<number>>,
  partySize: number,
  policy: TableMatchPolicy = 'smallest_fit'
): TableAssignment | null {
  if (partySize < 1) return null

  const fits = inventory
    .filter((t) =>
      policy === 'exact_only' ? t.capacity === partySize : t.capacity >= partySize
    )
    .filter((t) => t.count > 0)
    .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name))

  for (const tt of fits) {
    const used = occupied.get(tt.id) || new Set<number>()
    for (let i = 1; i <= tt.count; i++) {
      if (!used.has(i)) {
        return { tableId: tt.id, tableName: tt.name, instanceIdx: i }
      }
    }
  }
  return null
}

export function partyFitsInventory(inventory: TableType[], partySize: number, policy: TableMatchPolicy): boolean {
  return inventory.some((t) => t.count > 0 && (policy === 'exact_only' ? t.capacity === partySize : t.capacity >= partySize))
}

export function summarizeAvailability(
  inventory: TableType[],
  occupied: Map<string, Set<number>>
): Array<{ tableId: string; tableName: string; capacity: number; available: number }> {
  return inventory.map((tt) => ({
    tableId: tt.id,
    tableName: tt.name,
    capacity: tt.capacity,
    available: Math.max(0, tt.count - (occupied.get(tt.id)?.size || 0)),
  }))
}

export function formatTableLine(a: TableAssignment): string {
  return `Table: ${a.tableName} #${a.instanceIdx} [${a.tableId}]`
}

export function replaceTableLine(description: string | null | undefined, newLine: string): string {
  const lines = descriptionText(description).replace(/\r\n/g, '\n').split('\n')
  let metaEnd = lines.findIndex((l) => l.trim() === '' || META_END_REGEX.test(l))
  if (metaEnd < 0) metaEnd = lines.length
  const meta = lines.slice(0, metaEnd).filter((l) => !TABLE_LABEL_REGEX.test(l))
  const rest = lines.slice(metaEnd).filter((l) => !TABLE_SHAPE_REGEX.test(l))
  const partyIdx = meta.findIndex((l) => PARTY_LABEL_REGEX.test(l))
  if (partyIdx >= 0) meta.splice(partyIdx + 1, 0, newLine)
  else meta.push(newLine)
  const out = [...meta, ...rest]
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out.join('\n')
}

export type CapacitySlot = {
  start: string
  end: string
  seatsAvailable?: number
  tablesAvailable?: number
  availableTables?: Array<{ name: string; capacity: number; available: number }>
}

export function capacitySlotFilter(opts: {
  mode: 'simple' | 'tables'
  events: TableEvent[]
  inventory: TableType[]
  policy: TableMatchPolicy
  simpleCapacity: number
  partySize: number | null
  timezone: string
}): (slot: { start: string; end: string }) => CapacitySlot | null {
  const { mode, events, inventory, policy, simpleCapacity, partySize, timezone } = opts
  const ranged = events
    .filter((ev) => !isFreeEvent(ev))
    .map((ev) => ({ ev, r: eventRangeMs(ev, timezone) }))
    .filter((x): x is { ev: TableEvent; r: { s: number; e: number } } => x.r !== null)
  return (slot) => {
    const sMs = new Date(slot.start).getTime()
    const eMs = new Date(slot.end).getTime()
    const overlapping = ranged.filter((x) => x.r.s < eMs && x.r.e > sMs).map((x) => x.ev)
    if (mode === 'simple') {
      const { used, blocked } = computeSeatUsage(overlapping, sMs, eMs, timezone)
      const avail = blocked ? 0 : Math.max(0, simpleCapacity - used)
      return avail >= (partySize ?? 1) ? { ...slot, seatsAvailable: avail } : null
    }
    const { occupied, blocked } = computeTableOccupancy(overlapping, inventory, sMs, eMs, timezone)
    if (blocked) return null
    const summary = summarizeAvailability(inventory, occupied).filter((t) =>
      partySize === null || (policy === 'exact_only' ? t.capacity === partySize : t.capacity >= partySize)
    )
    const fits = partySize === null
      ? summary.some((t) => t.available > 0)
      : assignTable(inventory, occupied, partySize, policy) !== null
    if (!fits) return null
    return {
      ...slot,
      availableTables: summary
        .filter((t) => t.available > 0)
        .map((t) => ({ name: t.tableName, capacity: t.capacity, available: t.available })),
      tablesAvailable: summary.reduce((acc, t) => acc + t.available, 0),
    }
  }
}


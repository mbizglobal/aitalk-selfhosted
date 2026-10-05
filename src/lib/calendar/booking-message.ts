
import { descriptionText } from './capacity'
import { descriptionLineValue } from './contact-description'

const NOTES_LINE_REGEX = /^\s*notes\s*[:：]\s*(.*)$/i
const LABEL_LINE_REGEX = /^\s*(name|phone|email|party|table|notes|source)\s*[:：]/i
const SOURCE_LINE_REGEX = /^\s*source\s*[:：]/i

export const BOOKING_MESSAGE_PROMPT_MAX = 200
const DEFAULT_BOOKING_MESSAGE_PROMPT = 'Would you like to leave a message for us? It is optional.'

function splitLines(description: string | null | undefined): string[] {
  return descriptionText(description).replace(/\r\n/g, '\n').split('\n')
}

function findNotesBlock(lines: string[]): { start: number; end: number; text: string } | null {
  const start = lines.findIndex((l) => NOTES_LINE_REGEX.test(l))
  if (start < 0) return null
  const parts = [lines[start].match(NOTES_LINE_REGEX)![1]]
  let end = start + 1
  while (end < lines.length && lines[end].trim() !== '' && !LABEL_LINE_REGEX.test(lines[end])) {
    parts.push(lines[end])
    end++
  }
  return { start, end, text: parts.map((s) => s.trim()).filter(Boolean).join(' ') }
}

export function notesFromDescription(description: string | null | undefined): string | undefined {
  const block = findNotesBlock(splitLines(description))
  return block?.text || undefined
}

export function notesFromEvent(ev: {
  description?: string | null
  body?: { content?: string | null } | null
}): string | undefined {
  return notesFromDescription(ev?.description ?? ev?.body?.content)
}

export function replaceNotesInDescription(description: string | null | undefined, newNotes: string): string {
  const line = `Notes: ${descriptionLineValue(newNotes)}`
  const lines = splitLines(description)
  const block = findNotesBlock(lines)
  if (block) {
    lines.splice(block.start, block.end - block.start, line)
    return lines.join('\n')
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length === 0) return line
  const sourceIdx = lines.findIndex((l) => SOURCE_LINE_REGEX.test(l))
  if (sourceIdx < 0) return [...lines, '', line].join('\n')
  const before = lines.slice(0, sourceIdx)
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop()
  return [...before, ...(before.length > 0 ? [''] : []), line, '', ...lines.slice(sourceIdx)].join('\n')
}

export function removeNotesFromDescription(description: string | null | undefined): string {
  const lines = splitLines(description)
  const block = findNotesBlock(lines)
  if (!block) return String(description ?? '')
  const before = lines.slice(0, block.start)
  const after = lines.slice(block.end)
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop()
  while (after.length > 0 && after[0].trim() === '') after.shift()
  return [...before, ...(before.length > 0 && after.length > 0 ? [''] : []), ...after].join('\n')
}

export function bookingMessagePromptOf(nodeData: unknown): string | undefined {
  const d = (nodeData ?? {}) as { askBookingMessage?: unknown; bookingMessagePrompt?: unknown }
  if (d.askBookingMessage !== true) return undefined
  const raw = typeof d.bookingMessagePrompt === 'string' ? d.bookingMessagePrompt : ''
  const oneLine = raw.replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, BOOKING_MESSAGE_PROMPT_MAX).trim()
  return oneLine || DEFAULT_BOOKING_MESSAGE_PROMPT
}

const quoted = (v: string) => `"${v.replace(/"/g, "'")}"`

export const UPDATE_NOTES_TOOL_DESC =
  `MESSAGE (notes): this tool also changes the customer's MESSAGE on their booking (the "Notes" line) — on every channel, including PSTN calls. ` +
  `Triggers (any language): Korean "메시지 바꿔 주세요/메모 수정/메시지 남길게요", English "change/add my message", German "Nachricht ändern", French "changer mon message", Spanish "cambiar mi mensaje". ` +
  `Pass new_notes with the COMPLETE new message — it REPLACES the message on file, so include anything they still want to keep. ` +
  `To ADD a request while keeping what is already there (e.g. their answer when you ask for any requests after booking), pass ONLY add_notes with just the new request — the server appends it. ` +
  `If they have not said the new message yet, pass ONLY pending_field='notes' and follow the "instruction" in the result. ` +
  `To REMOVE the message ("메시지 지워 주세요", "delete my message"), pass ONLY clear_notes=true. One field per call applies to new_notes, add_notes and clear_notes too. ` +
  `Call this tool in the SAME reply as the request, with no preamble before it — no "let me check if I can note that". The write takes under a second, so answer only after the result. On a voice call a spoken preamble can be interrupted, which cancels the reply and takes the unsent tool call with it; never conclude there was no request just because your previous reply was cut off.`

export const UPDATE_NOTES_PARAM = {
  type: 'string',
  description:
    "Optional. The customer's complete new message for the booking — replaces the Notes line. ONLY pass when they said it in the current turn — or when they asked to REPLACE their message in the turn just before and your call was cut off before it ran, in which case save it now without asking them to repeat it. Never together with new_name, new_phone, add_notes, clear_notes, or pending_field='name'/'phone'.",
}

export const ADD_NOTES_PARAM = {
  type: 'string',
  description:
    "Optional. A request to ADD to the booking's message, keeping what is already there — pass only the new part, in the customer's own words, briefly. ONLY pass when they said it in the current turn — or when they said it in the turn just before and your call was cut off before it ran, in which case save it now without asking them to repeat it (recover it the way they meant it: ADDING a request goes here, REPLACING the whole message goes in new_notes). Never together with new_name, new_phone, new_notes, clear_notes, or pending_field='name'/'phone'.",
}

export const CLEAR_NOTES_PARAM = {
  type: 'boolean',
  description:
    "OPTIONAL — pass true ONLY when the customer explicitly asks to remove their message from the booking — including when they asked in the turn just before and your call was cut off before it ran. Never together with new_notes, add_notes, new_name, new_phone, or pending_field='name'/'phone'.",
}

export type NotesChange =
  | { kind: 'ask' }
  | { kind: 'set'; value: string }
  | { kind: 'add'; value: string }
  | { kind: 'clear' }

export function notesChangeOf(args: Record<string, unknown> | null | undefined): NotesChange | 'mixed' | null {
  const a = args ?? {}
  const value = typeof a.new_notes === 'string' ? descriptionLineValue(a.new_notes) : ''
  const added = typeof a.add_notes === 'string' ? descriptionLineValue(a.add_notes) : ''
  const clear = a.clear_notes === true
  if (!value && !added && !clear && a.pending_field !== 'notes') return null
  const hasOther =
    (typeof a.new_name === 'string' && a.new_name.trim().length > 0) ||
    (typeof a.new_phone === 'string' && a.new_phone.trim().length > 0)
  const otherPending = a.pending_field === 'name' || a.pending_field === 'phone'
  const writes = [value, added, clear].filter(Boolean).length
  if (hasOther || (writes > 0 && otherPending) || writes > 1) return 'mixed'
  if (clear) return { kind: 'clear' }
  if (value) return { kind: 'set', value }
  if (added) return { kind: 'add', value: added }
  return { kind: 'ask' }
}

export function notesToSave(change: { kind: 'set' | 'add'; value: string }, current: string | undefined): string | null {
  if (change.kind === 'set') return current === change.value ? null : change.value
  const items = (current ?? '').split(';').map((s) => s.trim()).filter(Boolean)
  const fresh: string[] = []
  for (const item of change.value.split(';').map((s) => s.trim())) {
    if (item && !items.includes(item) && !fresh.includes(item)) fresh.push(item)
  }
  if (fresh.length === 0) return null
  return [...(current ? [current] : []), ...fresh].join('; ')
}

export const NOTES_ONE_FIELD_REFUSAL = {
  success: false,
  error: 'one_field_at_a_time',
  refusal_message: 'Update one field per call — process the first field, confirm, then handle the next one.',
}

export function notesAskResult(eventId: string, current: string | undefined) {
  return {
    success: true,
    event_id: eventId,
    ask_for_value: true,
    field: 'notes',
    ...(current ? { current_value: current } : {}),
    instruction: (current
      ? `Tell the customer the message on their booking is ${quoted(current)}, then ask what the new message should be. Speak this now.`
      : `Tell the customer there is no message on their booking yet, then ask what they would like to leave. Speak this now.`) +
      ` They may say it in several pieces with pauses — let them finish; if it sounds unfinished, just give a very short go-ahead. Never ask for one complete sentence or give examples.`,
  }
}

export function notesUnchangedResult(eventId: string, current: string, added?: string) {
  if (added) {
    return {
      success: true,
      event_id: eventId,
      unchanged: true,
      field: 'notes',
      instruction: `The request ${quoted(added)} is already on the booking — tell the customer briefly that nothing needed to change.`,
    }
  }
  return {
    success: true,
    event_id: eventId,
    unchanged: true,
    field: 'notes',
    current_value: current,
    instruction: `The message on file is already ${quoted(current)} — tell the customer nothing needed to change.`,
  }
}

export function notesUpdatedResult(eventId: string, value: string) {
  return {
    success: true,
    event_id: eventId,
    updated_field: 'notes',
    notes: value,
    instruction: `The message is saved. Tell the customer briefly that the message on their booking is now ${quoted(value)}.`,
  }
}

export function notesAddedResult(eventId: string, current: string | undefined, value: string) {
  const added = current ? value.slice(current.length + 2) : value
  return {
    success: true,
    event_id: eventId,
    updated_field: 'notes',
    notes: value,
    added,
    instruction: `The request ${quoted(added)} has been added to the booking. Tell the customer briefly.`,
  }
}

export function notesClearedResult(eventId: string, hadMessage: boolean) {
  return {
    success: true,
    event_id: eventId,
    updated_field: 'notes',
    cleared: true,
    ...(hadMessage ? {} : { unchanged: true }),
    instruction: hadMessage
      ? 'The message has been removed from the booking. Tell the customer briefly.'
      : 'There was no message on the booking — tell the customer there was nothing to remove.',
  }
}

export function bookingMessageRule(prompt: string | undefined): string {
  if (!prompt) return ''
  return (
    `OPTIONAL MESSAGE: do NOT ask for a message or special requests before booking — if the customer volunteers one, pass it as notes. ` +
    `After book_calendar_event succeeds, ask ONCE, in the customer's language, the equivalent of: "${prompt}". It is optional. ` +
    `If they give one, call update_event_contact with that booking's event_id, in their own words and briefly — add_notes to keep what is already on the booking (the usual case), new_notes to replace the whole message, clear_notes=true to remove it. One field per call. ` +
    `Then decide in this order — ask the question itself only once in this conversation, and once you reach a decision do not raise it again: ` +
    `(1) their LATEST turn takes back or corrects an earlier request → follow the latest turn, never the earlier words. TAKING IT BACK ("아니요, 없어요", "그건 빼 주세요"): if it was never saved, save nothing; if it is already on the booking, change what is stored — new_notes with the message as it should now read, or clear_notes=true when nothing should remain. CORRECTING IT ("창가 말고 복도요"): save the corrected version — add_notes when their earlier words are NOT on the booking yet, new_notes when they are. Any new_notes must carry the whole message as it should now read: the corrected wording plus every other request already on the booking; ` +
    `(2) they asked for something in that turn, or in the one just before when your own reply was cut off before the call ran → save it now, their words picking the field; ` +
    `(3) they said they have none ("없어요", "no thanks") → there is no request, just continue — a cut-off reply does not change that; ` +
    `(4) their answer was unclear — including when you cannot tell whether it is a request → ask that one thing again (this is the only re-ask allowed); ` +
    `(5) anything else → just continue. Never decide on your own that they wanted nothing.`
  )
}

export function bookingMessageNextStep(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined
  return (
    `BOOKED. Confirm the booking to the customer in one short sentence, then ask ONCE, in their language, the equivalent of: "${prompt}" (optional) — ` +
    `unless you already asked it earlier in this conversation. If they give a request, call update_event_contact with this eventId and add_notes ` +
    `(briefly, in their own words) — with no preamble before the call. If they say they have none, just continue; never conclude that on your own.`
  )
}

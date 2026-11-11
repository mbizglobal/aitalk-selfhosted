import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { decryptJson, encryptJson } from './sealed'
import { readProjectFile, type WorkFileDeps } from './files'
import { pageLines } from './file-text'
import { renderPdfPages } from './pdf-pages'
import { isProjectDetached, lockProjectForWrite, type SheetActor } from './sheet-gate'
import { describeCaughtError } from '@/lib/log-mask'
import type { FixedCpaHold } from '@/lib/workflow/ai-call-cpa'
import type { ReadImagesFn } from '@/lib/workflow/nodes/ai/read-images'

export const DOC_READ_BLOCK_PAGES = 10
export const DOC_READ_MAX_PAGES = 500
export const DOC_READ_SCAN_CPA = 2
export const LAYER_MIN_CHARS = 40
const BIG_IMAGE_SHARE = 0.25
const CLAIM_MS = 60_000
const AI_FAIL_LIMIT = 3
const ENGINE_MIN_LEFT_MS = 8_000
const AI_PARALLEL = 2
const RENDER_CHUNK = 4
export const DOC_READ_IMAGE_MIME: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

export type PageState = 'ok' | 'blank' | 'failed' | 'cut' | 'unreadable'
export type PagePath = 'layer' | 'di' | 'ai' | 'layer+di' | 'layer+ai' | 'none'
export interface PageRec {
  n: number
  layer: string
  engine: string | null
  needsEngine: boolean
  state: PageState
  fails: number
  path: PagePath
}
export interface BlockView { blockNo: number; state: 'partial' | 'done'; pages: PageRec[] }

export type EngineOutcome = { kind: 'text'; text: string } | { kind: 'empty' } | { kind: 'cut' } | { kind: 'service' }

export interface DocReadEngine {
  readonly kind: 'di' | 'ai'
  readPdf(buffer: Buffer, pages: readonly number[], signal: AbortSignal): Promise<Map<number, EngineOutcome>>
  readImage(buffer: Buffer, mime: string, signal: AbortSignal): Promise<EngineOutcome>
}

export interface DocReadCtx {
  deps: WorkFileDeps
  userId: string
  projectId: string
  actor: SheetActor
  engine: DocReadEngine
  hold: () => Promise<FixedCpaHold>
  deadline: number
}

export type DocReadResult =
  | { ok: false; error: 'NOT_FOUND' | 'UNSUPPORTED' | 'TOO_MANY_PAGES' | 'EMPTY' | 'UNREADABLE_FILE' | 'READ_ONLY'; pages?: number }
  | {
    ok: true
    totalPages: number
    blocks: BlockView[]
    pending: { busy: number[]; notDone: number[]; creditShort: boolean; unavailable: boolean }
  }

type BlockRow = { id: string; block_no: number; total_pages: number; pages: Uint8Array; state: string }

const blockCount = (total: number) => Math.ceil(total / DOC_READ_BLOCK_PAGES)
const blockPages = (b: number, total: number) => {
  const from = b * DOC_READ_BLOCK_PAGES + 1
  return Array.from({ length: Math.min(DOC_READ_BLOCK_PAGES, total - from + 1) }, (_, k) => from + k)
}
const pageDone = (s: PageState) => s === 'ok' || s === 'blank' || s === 'unreadable'
const ts = (d: Date) => Prisma.sql`CAST(${d.toISOString()} AS timestamp)`

const PAGE_STATES: ReadonlySet<string> = new Set(['ok', 'blank', 'failed', 'cut', 'unreadable'])
const PAGE_PATHS: ReadonlySet<string> = new Set(['layer', 'di', 'ai', 'layer+di', 'layer+ai', 'none'])
export function isPageRecList(x: unknown, blockNo: number, totalPages: number): x is PageRec[] {
  if (!Array.isArray(x)) return false
  const want = blockPages(blockNo, totalPages)
  if (x.length > want.length) return false
  const seen = new Set<number>()
  return x.every((p) => {
    if (!p || typeof p !== 'object') return false
    const r = p as Record<string, unknown>
    if (!Number.isInteger(r.n) || !want.includes(r.n as number) || seen.has(r.n as number)) return false
    seen.add(r.n as number)
    return typeof r.layer === 'string' && (r.engine === null || typeof r.engine === 'string') && typeof r.needsEngine === 'boolean'
      && PAGE_STATES.has(r.state as string) && Number.isInteger(r.fails) && (r.fails as number) >= 0 && (r.fails as number) <= 10 && PAGE_PATHS.has(r.path as string)
  })
}
export function blockLooksDone(x: PageRec[], blockNo: number, totalPages: number): boolean {
  return x.length === blockPages(blockNo, totalPages).length && x.every((p) => pageDone(p.state))
}

export function pageTextsForFind(p: PageRec): Array<{ source: 'page text' | 'image text'; text: string }> {
  const out: Array<{ source: 'page text' | 'image text'; text: string }> = []
  const layerOk = p.needsEngine ? p.layer.trim().length >= LAYER_MIN_CHARS : p.layer.trim().length > 0
  if (layerOk) out.push({ source: 'page text', text: p.layer })
  if (p.engine && p.engine.trim()) out.push({ source: 'image text', text: p.engine })
  return out
}

async function pageImageShare(pdfjs: any, page: any): Promise<number> {
  const OPS = pdfjs.OPS as Record<string, number>
  const IMG = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintImageMaskXObjectGroup', 'paintInlineImageXObjectGroup'].filter((k) => k in OPS).map((k) => OPS[k]))
  const [x0, y0, x1, y1] = page.view as number[]
  const area = Math.abs((x1 - x0) * (y1 - y0)) || 1
  const ol = await page.getOperatorList()
  let det = 1
  const stack: number[] = []
  let best = 0
  for (let k = 0; k < ol.fnArray.length; k++) {
    const fn = ol.fnArray[k]
    const a = ol.argsArray[k] as any
    if (fn === OPS.save) stack.push(det)
    else if (fn === OPS.restore) det = stack.pop() ?? 1
    else if (fn === OPS.transform) det *= a[0] * a[3] - a[1] * a[2]
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(det); const m = a?.[0]; if (Array.isArray(m) || ArrayBuffer.isView(m)) det *= (m as any)[0] * (m as any)[3] - (m as any)[1] * (m as any)[2] }
    else if (fn === OPS.paintFormXObjectEnd) det = stack.pop() ?? 1
    else if (IMG.has(fn)) best = Math.max(best, Math.abs(det) / area)
  }
  return best
}

export function freshPage(n: number, layer: string, imageShare: number): PageRec {
  const short = layer.trim().length < LAYER_MIN_CHARS
  const needsEngine = imageShare > BIG_IMAGE_SHARE || (imageShare > 0 && short)
  if (needsEngine) return { n, layer, engine: null, needsEngine, state: 'failed', fails: 0, path: 'none' }
  return { n, layer, engine: null, needsEngine, state: layer.trim() ? 'ok' : 'blank', fails: 0, path: 'layer' }
}

export function applyEngine(p: PageRec, r: EngineOutcome, kind: 'di' | 'ai'): PageRec {
  const withLayer = p.layer.trim().length >= LAYER_MIN_CHARS
  if (r.kind === 'text' && r.text.trim()) return { ...p, engine: r.text, state: 'ok', path: withLayer ? (kind === 'di' ? 'layer+di' : 'layer+ai') : kind }
  if (r.kind === 'service') return { ...p, state: 'failed' }
  if (kind === 'di' && r.kind !== 'cut') return { ...p, state: 'unreadable', path: withLayer ? 'layer' : 'none' }
  const fails = p.fails + 1
  if (fails >= AI_FAIL_LIMIT) return { ...p, fails, state: 'unreadable', path: withLayer ? 'layer' : 'none' }
  return { ...p, fails, state: r.kind === 'cut' ? 'cut' : 'failed' }
}

class SaveAbort extends Error {}

export async function readDocumentPages(c: DocReadCtx, fileId: string): Promise<DocReadResult> {
  const db = c.deps.db
  const f = await db.workFile.findFirst({ where: { id: fileId, projectId: c.projectId, userId: c.userId }, select: { id: true, mimeType: true, parentFileId: true } })
  if (!f || f.parentFileId) return { ok: false, error: 'NOT_FOUND' }
  const isPdf = f.mimeType === 'application/pdf'
  if (!isPdf && !DOC_READ_IMAGE_MIME.has(f.mimeType)) return { ok: false, error: 'UNSUPPORTED' }
  const key = await c.deps.dataKey(db, c.userId)

  const loadRows = async () => db.$queryRaw<BlockRow[]>(Prisma.sql`SELECT id, block_no, total_pages, pages, state FROM work_file_page_block WHERE file_id = ${fileId} AND project_id = ${c.projectId} AND user_id = ${c.userId} ORDER BY block_no`)
  const view = (r: BlockRow): BlockView => ({ blockNo: r.block_no, state: r.state === 'done' ? 'done' : 'partial', pages: decryptJson<PageRec[]>(r.pages, key) })
  const rows0 = await loadRows()
  if (rows0.length && rows0.length === blockCount(rows0[0].total_pages) && rows0.every((r) => r.state === 'done')) {
    return { ok: true, totalPages: rows0[0].total_pages, blocks: rows0.map(view), pending: { busy: [], notDone: [], creditShort: false, unavailable: false } }
  }

  const p = await db.workProject.findFirst({ where: { id: c.projectId, userId: c.userId }, select: { status: true, workflowId: true, workflowLinkedAt: true } })
  if (!p) return { ok: false, error: 'NOT_FOUND' }
  const appClosed = (await db.$transaction((tx) => lockProjectForWrite(tx, c.userId, c.projectId))).appClosed
  const writable = p.status === 'active' && !isProjectDetached(p) && !appClosed
  if (!writable) {
    if (!rows0.length) return { ok: false, error: 'READ_ONLY' }
    const total = rows0[0].total_pages
    return { ok: true, totalPages: total, blocks: rows0.map(view), pending: { busy: [], notDone: Array.from({ length: blockCount(total) }, (_, b) => b).filter((b) => !rows0.some((r) => r.block_no === b && r.state === 'done')), creditShort: false, unavailable: false } }
  }

  const { buffer } = await readProjectFile(c.deps, { userId: c.userId, fileId, actor: c.actor, mergeReadMs: 10 * 60_000 })
  let pdfjs: any = null
  let doc: any = null
  try {
    let total = 1
    if (isPdf) {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      try {
        doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise
      } catch {
        return { ok: false, error: 'UNREADABLE_FILE' }
      }
      total = doc.numPages
      if (total < 1) return { ok: false, error: 'EMPTY' }
      if (total > DOC_READ_MAX_PAGES) return { ok: false, error: 'TOO_MANY_PAGES', pages: total }
    }

    const claimId = randomUUID()
    const busy: number[] = []
    const claimed: Array<{ row: BlockRow; pages: PageRec[] }> = []
    const wantBlocks = Array.from({ length: blockCount(total) }, (_, b) => b).filter((b) => !rows0.some((r) => r.block_no === b && r.state === 'done'))
    const holds = new Map<number, FixedCpaHold>()
    const saved = new Set<number>()
    const settledBlocks = new Set<number>()
    let creditShort = false
    let unavailable = false
    try {
      const empty = encryptJson([], key)
      for (const b of wantBlocks) {
        const now = new Date()
        const got = await db.$queryRaw<BlockRow[]>(Prisma.sql`
          INSERT INTO work_file_page_block (id, file_id, project_id, user_id, block_no, total_pages, pages, state, charged, claim_id, claim_until, updated_at)
          VALUES (${randomUUID().replace(/-/g, '').slice(0, 25)}, ${fileId}, ${c.projectId}, ${c.userId}, ${b}, ${total}, ${Buffer.from(empty)}, 'partial', false, ${claimId}, ${ts(new Date(now.getTime() + CLAIM_MS))}, ${ts(now)})
          ON CONFLICT (file_id, block_no) DO UPDATE SET claim_id = EXCLUDED.claim_id, claim_until = EXCLUDED.claim_until, updated_at = EXCLUDED.updated_at
          WHERE work_file_page_block.state <> 'done' AND (work_file_page_block.claim_id IS NULL OR work_file_page_block.claim_until < ${ts(now)})
          RETURNING id, block_no, total_pages, pages, state`)
        if (got.length !== 1) { busy.push(b); continue }
        claimed.push({ row: got[0], pages: decryptJson<PageRec[]>(got[0].pages, key) })
      }

      for (const cb of claimed) {
        const prev = new Map(cb.pages.map((pg) => [pg.n, pg]))
        const next: PageRec[] = []
        for (const n of blockPages(cb.row.block_no, total)) {
          const old = prev.get(n)
          if (old && pageDone(old.state)) { next.push(old); continue }
          let fresh: PageRec
          if (!isPdf) fresh = { n, layer: '', engine: null, needsEngine: true, state: 'failed', fails: 0, path: 'none' }
          else {
            const page = await doc.getPage(n)
            const layer = pageLines((await page.getTextContent()).items)
            fresh = freshPage(n, layer, await pageImageShare(pdfjs, page))
            page.cleanup()
          }
          next.push(old ? { ...fresh, fails: old.fails } : fresh)
        }
        cb.pages = next
      }

      const engineBlocks = claimed.filter((cb) => cb.pages.some((pg) => !pageDone(pg.state)))
      const run: typeof claimed = []
      for (const cb of engineBlocks) {
        if (c.deadline - Date.now() < ENGINE_MIN_LEFT_MS) break
        try {
          holds.set(cb.row.block_no, await c.hold())
          run.push(cb)
        } catch (e) {
          const code = (e as { code?: unknown } | null)?.code
          if (code === 'INSUFFICIENT_CPA') { creditShort = true; break }
          if (code === 'CPA_UNAVAILABLE') { unavailable = true; break }
          throw e
        }
      }

      if (run.length && c.deadline - Date.now() < ENGINE_MIN_LEFT_MS / 2) run.length = 0

      const signal = AbortSignal.timeout(Math.max(1_000, c.deadline - Date.now()))
      const todo = run.flatMap((cb) => cb.pages.filter((pg) => !pageDone(pg.state)).map((pg) => pg.n))
      const results = new Map<number, EngineOutcome>()
      if (todo.length) {
        if (!isPdf) {
          results.set(1, await c.engine.readImage(buffer, f.mimeType, signal).catch((e) => { console.warn(`[work-ai] doc read image: ${describeCaughtError(e)}`); return { kind: 'service' } as EngineOutcome }))
        } else {
          try {
            const m = await c.engine.readPdf(buffer, todo, signal)
            for (const n of todo) results.set(n, m.get(n) ?? (c.engine.kind === 'di' ? { kind: 'empty' } : { kind: 'service' }))
          } catch (e) {
            console.warn(`[work-ai] doc read engine: ${describeCaughtError(e)}`)
            for (const n of todo) results.set(n, { kind: 'service' })
          }
        }
      }
      for (const cb of run) cb.pages = cb.pages.map((pg) => (pageDone(pg.state) ? pg : applyEngine(pg, results.get(pg.n) ?? { kind: 'service' }, c.engine.kind)))

      for (const cb of claimed) {
        const done = cb.pages.every((pg) => pageDone(pg.state))
        const hold = holds.get(cb.row.block_no) ?? null
        const engineRead = cb.pages.some((pg) => pg.needsEngine && pg.state === 'ok')
        const charge = done && !!hold?.reservationId && engineRead
        const ok = await db.$transaction(async (tx) => {
          const lp = await lockProjectForWrite(tx, c.userId, c.projectId)
          if (lp.status !== 'active' || isProjectDetached(lp) || lp.appClosed) return false
          const w = await tx.$executeRaw(Prisma.sql`
            UPDATE work_file_page_block SET pages = ${Buffer.from(encryptJson(cb.pages, key))}, state = ${done ? 'done' : 'partial'},
              charged = charged OR ${charge}, claim_id = NULL, claim_until = NULL, updated_at = ${ts(new Date())}
            WHERE id = ${cb.row.id} AND claim_id = ${claimId}`)
          if (w !== 1) return false
          if (charge && !(await hold!.settleInTx(tx as never))) throw new SaveAbort()
          return true
        }).catch((e) => { if (e instanceof SaveAbort) return false; throw e })
        if (ok) {
          saved.add(cb.row.block_no)
          if (charge) {
            hold!.markSettled()
            settledBlocks.add(cb.row.block_no)
            console.log(`[CPA] doc read ${fileId} block ${cb.row.block_no} = ${DOC_READ_SCAN_CPA} CPA (${c.engine.kind})`)
          }
        }
      }
    } finally {
      for (const [b, h] of holds) {
        if (h.reservationId && !settledBlocks.has(b)) console.log(`[CPA] doc read ${fileId} block ${b} = 0 CPA (refunded)`)
        h.cancel()
      }
      const left = claimed.filter((cb) => !saved.has(cb.row.block_no)).map((cb) => cb.row.id)
      if (left.length) {
        await db.$executeRaw(Prisma.sql`UPDATE work_file_page_block SET claim_id = NULL, claim_until = ${ts(new Date())} WHERE id IN (${Prisma.join(left)}) AND claim_id = ${claimId}`)
          .catch((e) => console.warn(`[work-ai] doc read release: ${describeCaughtError(e)}`))
      }
    }

    const rows = await loadRows()
    const blocks = rows.map(view)
    const notDone = Array.from({ length: blockCount(total) }, (_, b) => b).filter((b) => !rows.some((r) => r.block_no === b && r.state === 'done') && !busy.includes(b))
    return { ok: true, totalPages: total, blocks, pending: { busy, notDone, creditShort, unavailable } }
  } finally {
    if (doc) await doc.destroy().catch(() => {})
  }
}

export function diPagesParam(pages: readonly number[]): string {
  const s = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < s.length;) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    parts.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`)
    i = j + 1
  }
  return parts.join(',')
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new Error('aborted'))
  const t = setTimeout(() => { signal.removeEventListener('abort', on); resolve() }, ms)
  const on = () => { clearTimeout(t); reject(new Error('aborted')) }
  signal.addEventListener('abort', on, { once: true })
})

export function makeDiEngine(cfg: { endpoint: string; key: string }, fetchFn: typeof fetch = fetch): DocReadEngine {
  const base = cfg.endpoint.replace(/\/+$/, '')
  const analyze = async (body: Buffer, mime: string, pages: string | null, signal: AbortSignal) => {
    const url = `${base}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30${pages ? `&pages=${pages}` : ''}`
    const res = await fetchFn(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': mime }, body: body as unknown as BodyInit, signal })
    if (!res.ok) throw new Error(`DI analyze ${res.status}`)
    const op = res.headers.get('Operation-Location')
    if (!op) throw new Error('DI: no Operation-Location')
    for (;;) {
      await sleep(1_000, signal)
      const r = await fetchFn(op, { headers: { 'Ocp-Apim-Subscription-Key': cfg.key }, signal })
      if (!r.ok) throw new Error(`DI poll ${r.status}`)
      const j = await r.json() as { status: string; analyzeResult?: { pages?: Array<{ pageNumber: number; lines?: Array<{ content: string }> }> } }
      if (j.status === 'succeeded') {
        const m = new Map<number, EngineOutcome>()
        for (const pg of j.analyzeResult?.pages ?? []) {
          const text = (pg.lines ?? []).map((l) => l.content).join('\n')
          m.set(pg.pageNumber, text.trim() ? { kind: 'text', text } : { kind: 'empty' })
        }
        return m
      }
      if (j.status === 'failed') throw new Error('DI analysis failed')
    }
  }
  return {
    kind: 'di',
    readPdf: (buffer, pages, signal) => analyze(buffer, 'application/pdf', diPagesParam(pages), signal),
    async readImage(buffer, mime, signal) {
      const m = await analyze(buffer, mime, null, signal)
      return m.get(1) ?? { kind: 'empty' }
    },
  }
}

export function makeAiEngine(readImages: ReadImagesFn, parallel = AI_PARALLEL): DocReadEngine {
  const one = async (mime: string, base64: string, label: string): Promise<EngineOutcome> => {
    const r = await readImages([{ mime, base64 }], label, { free: true })
    if (r.truncated) return { kind: 'cut' }
    return r.text.trim() ? { kind: 'text', text: r.text } : { kind: 'empty' }
  }
  return {
    kind: 'ai',
    async readPdf(buffer, pages, signal) {
      const m = new Map<number, EngineOutcome>()
      for (let at = 0; at < pages.length; at += RENDER_CHUNK) {
        const chunk = pages.slice(at, at + RENDER_CHUNK)
        if (signal.aborted) { for (const n of chunk) m.set(n, { kind: 'service' }); continue }
        const img = await renderPdfPages(buffer, 0, chunk)
        const byNo = new Map(img.numbers.map((n, i) => [n, img.images[i]]))
        let next = 0
        const worker = async () => {
          while (next < chunk.length) {
            const n = chunk[next++]
            if (signal.aborted) { m.set(n, { kind: 'service' }); continue }
            const jpg = byNo.get(n)
            if (!jpg) { m.set(n, { kind: 'service' }); continue }
            try {
              m.set(n, await one('image/jpeg', jpg.toString('base64'), `Document page ${n}`))
            } catch (e) {
              if ((e as { code?: unknown } | null)?.code === 'NO_IMAGE_MODEL') throw e
              console.warn(`[work-ai] doc read AI page ${n}: ${describeCaughtError(e)}`)
              m.set(n, { kind: 'service' })
            }
          }
        }
        const settled = await Promise.allSettled(Array.from({ length: Math.min(parallel, chunk.length) }, worker))
        const failed = settled.find((x): x is PromiseRejectedResult => x.status === 'rejected')
        if (failed) throw failed.reason
      }
      return m
    },
    async readImage(buffer, mime, signal) {
      if (signal.aborted) throw new Error('aborted')
      if (mime === 'image/heic') return { kind: 'empty' }
      return one(mime, buffer.toString('base64'), 'Document photo')
    },
  }
}

export const DOC_READ_ERROR_TEXT: Record<Extract<DocReadResult, { ok: false }>['error'], string> = {
  NOT_FOUND: 'file not found in this work app (use an original file from the Files tab)',
  UNSUPPORTED: 'only PDF files and photos can be read this way',
  TOO_MANY_PAGES: `this PDF has more than ${DOC_READ_MAX_PAGES} pages — ask the person to split it`,
  EMPTY: 'this PDF has no pages',
  UNREADABLE_FILE: 'this PDF cannot be opened — ask the person to upload it again',
  READ_ONLY: 'this work app is read-only — documents cannot be read now',
}



import { WorkError } from '@/lib/work/errors'
import { decryptJson } from '@/lib/work/sealed'
import { readProjectSheet } from '@/lib/work/sheet-gate'
import { readProjectFile } from '@/lib/work/files'
import { runWorkModule } from '@/lib/work/module-registry'
import { recordWorkAppProposal } from '@/lib/work/app-scope'
import type { WorkAppTool, WorkAppToolCtx } from '@/lib/work/package-api'
import { fingerprintWith, parseRecipe, type BankRecipe } from './bank/recipe'
import { fileBalanceRequired, type BankImportPlan } from './modules/bank-import'
import { VAT_FAMILY } from './templates'
import { MAX_FX_MONTHS, ensureMonthlyFxRates, isFxMonth, readMonthlyFxRates } from './fx-bazg'

const PEEK_MAX_LINES = 40
const PEEK_MAX_CHARS = 8_000
const BANK_IMPORT_MODULE = 'bank.import'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v) throw new WorkError('INVALID', `${what} is required`)
  return v
}
function list<T>(v: unknown, what: string): T[] {
  if (!Array.isArray(v) || v.length === 0) throw new WorkError('INVALID', `${what} must be a non-empty list`)
  if (v.length > 50) throw new WorkError('INVALID', 'at most 50 per call')
  return v as T[]
}

async function savedReaders(ctx: WorkAppToolCtx): Promise<Array<{ recipeKey: string; label: string | null; bank: string; fingerprint: string; recipe: BankRecipe }>> {
  const sheets = await ctx.deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: ctx.scope.projectId, userId: ctx.userId, templateFamily: VAT_FAMILY.recipes }, select: { id: true } })
  const out: Array<{ recipeKey: string; label: string | null; bank: string; fingerprint: string; recipe: BankRecipe }> = []
  for (const sh of sheets) {
    const { rows } = await readProjectSheet(ctx.deps, { userId: ctx.userId, projectId: ctx.scope.projectId, sheetId: sh.id, workflowId: ctx.workflowId })
    for (const r of rows) {
      try {
        out.push({ recipeKey: String(r.data.recipeKey), label: typeof r.data.label === 'string' ? r.data.label : null, bank: String(r.data.bank), fingerprint: String(r.data.fingerprint), recipe: parseRecipe(r.data.recipe) })
      } catch { }
    }
  }
  return out
}

export const VAT_TOOLS: readonly WorkAppTool[] = [
  {
    def: {
      name: 'vat_peek_file',
      description: `Read the first lines of a project text file (CSV or text) as plain text — at most ${PEEK_MAX_LINES} lines and ${PEEK_MAX_CHARS} characters. Use it to see the shape of a bank statement before writing a reader. Also says which saved readers match this file.`,
      parameters: obj({ fileId: { type: 'string' }, lines: { type: 'integer', minimum: 1, maximum: PEEK_MAX_LINES } }, ['fileId']),
    },
    async run(ctx, args) {
      const p = ctx.project
      const fileId = str(args.fileId, 'fileId')
      const f = await ctx.deps.db.workFile.findFirst({ where: { id: fileId, projectId: p.id, userId: ctx.userId }, select: { mimeType: true } })
      if (!f) throw new WorkError('NOT_FOUND', 'file')
      if (f.mimeType !== 'text/csv' && f.mimeType !== 'text/plain') throw new WorkError('INVALID', 'only CSV or text files can be read this way — images and PDFs come with the message')
      const { buffer, originalName } = await readProjectFile(ctx.deps, { userId: ctx.userId, fileId, actor: ctx.actor })
      let text: string
      let encoding = 'utf-8'
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { text = new TextDecoder('windows-1252').decode(buffer); encoding = 'windows-1252' }
      const all = text.replace(/^\uFEFF/, '').split(/\r?\n/)
      const want = Math.min(Math.max(Number.isInteger(args.lines) ? (args.lines as number) : PEEK_MAX_LINES, 1), PEEK_MAX_LINES)
      const lines: string[] = []
      let used = 0
      for (const l of all.slice(0, want)) { if ((used += l.length + 1) > PEEK_MAX_CHARS) break; lines.push(l) }
      const readers = await savedReaders(ctx)
      return {
        name: originalName,
        encoding,
        totalLines: all.length,
        lines,
        ...(lines.length < all.length ? { note: `first ${lines.length} of ${all.length} lines` } : {}),
        savedReaders: readers.map((r) => ({ recipeKey: r.recipeKey, label: r.label, bank: r.bank, matchesThisFile: fingerprintWith(buffer, r.recipe) === r.fingerprint })),
      }
    },
  },
  {
    def: {
      name: 'vat_bank_import_plan',
      description: [
        'Plan importing a bank statement file into transactions. Nothing is written — the person presses the import button that appears under your answer.',
        'Reader: leave all out to use a saved reader that matches the file (or UBS); ubs=true for a UBS e-banking export; recipe = a reader you write for any other CSV; recipeKey = a saved reader.',
        'Recipe (JSON, only these keys): { v: 1, bank: "ubs"|"wise"|"revolut"|"other", delimiter: ","|";"|"\t", encoding: "utf-8"|"windows-1252", headerColumns: [names that identify the header row],',
        ' date: { column, format: "YYYY-MM-DD"|"DD-MM-YYYY"|"DD.MM.YYYY"|"DD/MM/YYYY"|"MM/DD/YYYY", timezone?: "UTC" (only when the column has a time) },',
        ' amount: { signed: column } | { debit: column, credit: column } | { value: column, direction: { column, in: [values], out: [values] } },',
        ' number: { decimal: "."|",", thousands: ""|"\u0027"|","|"."|" " }, currency: { column } | { fixed: "CHF" },',
        ' keep?: [{ column, in: [values] }] (keep only these rows, e.g. completed), account?: column naming the account when one file holds several,',
        ' txNo?: transaction id column, balanceAfter?: running balance column, counterparty?: [columns, first non-empty], bankType?: column, details?: [columns] }.',
        'Column names are the header texts exactly. If the plan shows a broken balance chain (bank_chain_broken), the recipe is wrong (sign, amount or fee column, date) — fix it and plan again before telling the person.',
        'accounts maps a group id (currency|account) to an accountKey of the Bank accounts sheet when the plan could not choose one.',
        'balances maps a group id to { opening, closing } — the bank balance just before the first day and at the end of the file period. Use it when the file has no balances (needsBalances): take them from what the person already gave you (text or a screenshot of the bank screen). The balance at the file\'s last day IS the closing balance even if the quarter ends later. The rows are checked against these amounts.',
      ].join('\n'),
      parameters: obj({
        fileId: { type: 'string' },
        ubs: { type: 'boolean' },
        recipe: { type: 'object' },
        recipeKey: { type: 'string' },
        accounts: { type: 'object' },
        balances: { type: 'object', description: 'group id → { opening, closing }, e.g. { "CHF|": { "opening": "7814.56", "closing": "7005.65" } }' },
        label: { type: 'string', description: 'A short name for a new reader, e.g. "Wise EUR statement".' },
      }, ['fileId']),
    },
    async run(ctx, args) {
      const p = ctx.project
      const fileId = str(args.fileId, 'fileId')
      const given = [args.ubs === true, args.recipe !== undefined, args.recipeKey !== undefined].filter(Boolean).length
      if (given > 1) throw new WorkError('INVALID', 'give only one of ubs, recipe, recipeKey')
      const reader = args.ubs === true ? 'ubs' as const : args.recipe !== undefined ? { recipe: args.recipe } : typeof args.recipeKey === 'string' ? { recipeKey: args.recipeKey } : undefined
      const accounts = args.accounts && typeof args.accounts === 'object' && !Array.isArray(args.accounts) ? args.accounts as Record<string, string> : undefined
      const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 100) : undefined
      const amt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null)
      const balEntries = args.balances && typeof args.balances === 'object' && !Array.isArray(args.balances)
        ? Object.entries(args.balances as Record<string, unknown>).flatMap(([id, v]) => {
          const o = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
          const opening = amt(o.opening); const closing = amt(o.closing)
          return opening && closing ? [[id, { opening, closing }] as const] : []
        })
        : []
      const balances = balEntries.length ? Object.fromEntries(balEntries) as Record<string, { opening: string; closing: string }> : undefined
      const plan = await runWorkModule(ctx.deps, {
        userId: ctx.userId, projectId: p.id, moduleId: BANK_IMPORT_MODULE,
        input: { step: 'plan', fileId, ...(reader ? { reader } : {}), ...(accounts ? { accounts } : {}), ...(balances ? { balances } : {}) }, by: ctx.actor,
      }) as BankImportPlan
      const rows = plan.groups.reduce((n, g) => n + (g.plan?.insert.length ?? 0), 0)
      const broken = plan.groups.some((g) => g.plan && (g.plan.balance.file === 'mismatch' || g.plan.balance.ledger === 'mismatch' || g.plan.problems.some((x) => x.code === 'bank_chain_broken') || (fileBalanceRequired(plan.reader, g) && !g.needsBalances)))
      let proposed = false
      if (!broken && rows > 0) {
        const f = await ctx.deps.db.workFile.findFirst({ where: { id: fileId, projectId: p.id, userId: ctx.userId }, select: { payload: true } })
        const fileName = f ? decryptJson<{ originalName: string }>(f.payload, await ctx.deps.dataKey(ctx.deps.db, ctx.userId)).originalName : fileId
        const cardReader = plan.reader.type === 'ubs' ? 'ubs' as const : plan.reader.saved && plan.reader.recipeKey ? { recipeKey: plan.reader.recipeKey } : { recipe: args.recipe }
        const chosen = Object.fromEntries(plan.groups.filter((g) => g.accountKey).map((g) => [g.id, g.accountKey!]))
        const usedBalances = balances ? Object.fromEntries(plan.groups.filter((g) => g.needsBalances && balances[g.id]).map((g) => [g.id, balances[g.id]])) : {}
        proposed = recordWorkAppProposal(ctx.scope.runId, { type: 'bank_import', module: BANK_IMPORT_MODULE, fileId, fileName, reader: cardReader, accounts: chosen, ...(Object.keys(usedBalances).length ? { balances: usedBalances } : {}), ...(label ? { label } : {}), rows, groups: plan.groups.length })
      }
      return {
        reader: plan.reader,
        filtered: plan.filtered,
        problems: plan.problems.map((x) => ({ code: x.code, ...(x.params ? { params: x.params } : {}), text: x.text })),
        groups: plan.groups.map((g) => ({
          id: g.id, currency: g.currency, account: g.account, accountKey: g.accountKey, candidates: g.candidates, needsBalances: g.needsBalances,
          ...(g.plan ? {
            insert: g.plan.insert.length, existing: g.plan.existing.length, classifiedByRules: g.plan.classified, balance: g.plan.balance,
            problems: g.plan.problems.map((x) => ({ code: x.code, ...(x.params ? { params: x.params } : {}), text: x.text })),
          } : {}),
          sample: g.sample,
        })),
        buttonShown: proposed,
        note: proposed
          ? 'Not imported yet. The person opens the import button under your answer, checks the plan and presses Add.'
          : broken ? 'No button shown — the balances do not add up. Fix the reader (or the balances you gave) and plan again.' : rows === 0 ? 'Nothing new to import.' : 'No button shown.',
        ...(plan.groups.some((g) => g.needsBalances && !balances?.[g.id]) ? { balancesNeeded: 'This file has no balances. If the person already gave them (text or screenshot), plan again with balances yourself. Otherwise ask once for the bank balance at the start and at the end of the file period — nothing else.' } : {}),
      }
    },
  },
  {
    def: {
      name: 'vat_fx_rates',
      description: `Get the official ESTV monthly average exchange rates (published by the Swiss Federal Office for Customs, BAZG) for months "YYYY-MM" — at most ${MAX_FX_MONTHS}. Rates missing in the app are fetched from BAZG and stored; the calculation module uses the same stored rates, so you never enter rates on rows yourself. rate = CHF for "unit" units of the currency (e.g. 100 JPY). Monthly averages only — daily rates are not fetched.`,
      parameters: obj({
        months: { type: 'array', minItems: 1, maxItems: MAX_FX_MONTHS, items: { type: 'string', description: 'YYYY-MM' } },
        currencies: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', description: 'ISO code, e.g. EUR' } },
      }, ['months', 'currencies']),
    },
    async run(ctx, args) {
        const months = list<unknown>(args.months, 'months').map((m) => str(m, 'month'))
      const bad = months.find((m) => !isFxMonth(m))
      if (bad) throw new WorkError('INVALID', `month must be YYYY-MM: ${bad}`)
      if (new Set(months).size > MAX_FX_MONTHS) throw new WorkError('INVALID', `at most ${MAX_FX_MONTHS} months at a time`)
      const currencies = list<unknown>(args.currencies, 'currencies').map((x) => str(x, 'currency').toUpperCase())
      const badCur = currencies.filter((x) => !/^[A-Z]{3}$/.test(x))
      if (badCur.length > 0) throw new WorkError('INVALID', `currencies must be ISO codes like EUR: ${badCur.join(', ')}`)
      const fetched = await ensureMonthlyFxRates(ctx.deps.db, months)
      const rates = await readMonthlyFxRates(ctx.deps.db, months, currencies)
      return {
        source: 'ESTV monthly average exchange rates, published by the Swiss Federal Office for Customs (BAZG)',
        months: fetched.map((f) => ({ month: f.month, status: f.status, ...(f.error ? { error: f.error } : {}) })),
        rates: rates.map((r) => ({ month: r.month, currency: r.currency, unit: r.unit, rate: r.rate })),
        note: 'status not_published = BAZG has not published that month yet; failed = BAZG could not be reached, try again later. Tell the person which rates are used (month, currency, rate).',
      }
    },
  },
]

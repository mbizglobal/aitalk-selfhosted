/**
 * Assembled app — a work app made from blocks and an app spec (no build). Its tables are sheets without template + the work_app_spec table
 * (src/lib/work/assembled.ts); the package itself has no sheets, modules or tools (design §19-1).
 */
import type { WorkAppFactory } from '@/lib/work/package-api'
import { specMailCard, specSendOpen } from '@/lib/work/assembled'
import { assembledWorkAppMeta } from './meta'
import { assembledAppTemplate } from './app-template'

export const assembledWorkApp: WorkAppFactory = () => ({
  id: 'assembled',
  version: '0.1.0',
  // 5 — sending (mail block) and send-ref hooks (sendRefs · core 4+)
  core: 5,
  meta: assembledWorkAppMeta,
  appTemplates: [assembledAppTemplate],
  sheetTemplates: [],
  modules: [],
  tools: [{
    def: {
      name: 'assembled_mail',
      description: 'Turn one row into a card from a send of this app (mails in work_overview — email, Telegram, HTTP to another system, a calendar event or an SMS to the customer). The text or values come from the app spec — you do not write them. A person must press send. If the send is "given", put the one email address in to. Refused with the reason when the row does not allow this send now.',
      parameters: { type: 'object', properties: { send: { type: 'string', description: 'send key' }, rowId: { type: 'string' }, to: { type: 'string', description: 'only for sends that go to an address you give' } }, required: ['send', 'rowId'], additionalProperties: false },
    },
    async run(ctx, args) {
      const send = (ctx as unknown as { send?: Parameters<typeof specMailCard>[0]['send'] }).send
      if (!send) throw new Error('send handle missing')
      const http = async () => {
        const [{ recordWorkAppProposal }, { defaultWorkFileDeps }] = await Promise.all([import('@/lib/work/app-scope'), import('@/lib/work/files')])
        return { deps: await defaultWorkFileDeps(), by: ctx.actor, taskId: ctx.scope.taskId ?? null, onCard: (sendId: string) => recordWorkAppProposal(ctx.scope.runId, { type: 'send', sendId }) }
      }
      return specMailCard({ userId: ctx.userId, projectId: ctx.project.id, send, http }, args)
    },
  }, {
    def: {
      name: 'assembled_doc',
      description: 'Make the PDF of one row from a document template of this app (docs in work_overview — for example a receipt or a confirmation). The text and layout come from the app\'s template — you do not write it. The PDF stays on the row; the same row values give back the same file. Tell the person its name; a send with a document attaches it.',
      parameters: { type: 'object', properties: { table: { type: 'string', description: 'table key' }, doc: { type: 'string', description: 'document template key' }, rowId: { type: 'string' } }, required: ['table', 'doc', 'rowId'], additionalProperties: false },
    },
    async run(ctx, args) {
      const [{ makeSpecDoc }, { defaultWorkFileDeps }] = await Promise.all([import('@/lib/work/assembled-doc'), import('@/lib/work/files')])
      if (typeof args.table !== 'string' || typeof args.doc !== 'string' || typeof args.rowId !== 'string') throw new Error('table, doc and rowId are required')
      const r = await makeSpecDoc(await defaultWorkFileDeps(), { userId: ctx.userId, projectId: ctx.project.id, table: args.table, doc: args.doc, rowId: args.rowId, actor: ctx.actor })
      return { fileId: r.fileId, name: r.name, note: r.made ? 'made — the PDF is on the row' : 'the row has not changed — this is the document made before' }
    },
  }, {
    def: {
      name: 'assembled_send',
      description: 'Turn one row into a card that sends it to another work app (sendsToApps in work_overview — for example an order to the shipping app). The values come from the app spec — you do not choose or write them. A person must press send; the other app gets a new unconfirmed row. Each row goes once per send: refused when it was already sent or a card is waiting, and refused with the reason when the row does not allow it now.',
      parameters: { type: 'object', properties: { send: { type: 'string', description: 'send key (sendsToApps)' }, rowId: { type: 'string' } }, required: ['send', 'rowId'], additionalProperties: false },
    },
    async run(ctx, args) {
      const [{ createAssembledSendCard }, { recordWorkAppProposal }, { defaultWorkFileDeps }] = await Promise.all([import('@/lib/work/app-send'), import('@/lib/work/app-scope'), import('@/lib/work/files')])
      const r = await createAssembledSendCard(await defaultWorkFileDeps(), { userId: ctx.userId, projectId: ctx.project.id, by: ctx.actor, taskId: ctx.scope.taskId ?? null }, args.send, args.rowId)
      recordWorkAppProposal(ctx.scope.runId, { type: 'send', sendId: r.sendId })
      return { status: 'card', sendId: r.sendId, to: r.toLabel, values: r.row, note: 'Nothing has been sent. The person sees the values on a card and presses Send — tell them.' }
    },
  }],
  // mail block — right before a card goes out, check again that its row still allows that send (design §19-3 block 8)
  sendRefs: {
    async canSend(ctx, input) {
      const [{ prisma }, { ensureUserDataKey }] = await Promise.all([import('@/lib/prisma'), import('@/lib/user-data-key')])
      return specSendOpen(prisma, await ensureUserDataKey(prisma, ctx.userId), { userId: ctx.userId, projectId: ctx.projectId, rowId: input.ref, refKey: input.key, attachFileIds: input.attachFileIds })
    },
    async afterSent() { /* nothing to record on the row — the card itself is the record */ },
  },
})

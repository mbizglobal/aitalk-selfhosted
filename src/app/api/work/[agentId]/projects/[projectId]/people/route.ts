
import { readJsonBody, workRoute } from '@/lib/work/http'
import { WorkError } from '@/lib/work/errors'
import { changeAppPerson, countAppPeople, inviteToApp, listAppPeople, removeAppInvite } from '@/lib/work/people'

type P = { agentId: string; projectId: string }

const intOf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN
  if (!Number.isInteger(n) || n <= 0) throw new WorkError('INVALID', 'id')
  return n
}

export const GET = workRoute<P>('people.list', async (req, { access, deps }, p) => {
  const u = new URL(req.url).searchParams
  if (u.get('count') === '1') return { count: await countAppPeople(deps, access, p.projectId) }
  const n = (k: string) => { const v = Number(u.get(k) ?? 0); return Number.isInteger(v) && v >= 0 ? v : 0 }
  return listAppPeople(deps, access, p.projectId, {
    tab: u.get('tab') === 'out' ? 'out' : 'in',
    search: u.get('q') ?? '',
    skip: n('skip'),
    inviteSkip: n('iskip'),
  })
})

export const POST = workRoute<P>('people.add', async (req, { access, deps }, p) => {
  const b = await readJsonBody(req)
  if (b.action === 'add') { await changeAppPerson(deps, access, p.projectId, intOf(b.memberId), 'add'); return { result: 'added' } }
  if (b.action === 'invite' && typeof b.email === 'string') return inviteToApp(deps, access, p.projectId, b.email)
  throw new WorkError('INVALID', 'action')
})

export const DELETE = workRoute<P>('people.remove', async (req, { access, deps }, p) => {
  const u = new URL(req.url).searchParams
  if (u.has('memberId')) await changeAppPerson(deps, access, p.projectId, intOf(u.get('memberId')), 'remove')
  else if (u.has('invitationId')) await removeAppInvite(deps, access, p.projectId, intOf(u.get('invitationId')))
  else throw new WorkError('INVALID', 'memberId or invitationId')
  return { ok: true }
})

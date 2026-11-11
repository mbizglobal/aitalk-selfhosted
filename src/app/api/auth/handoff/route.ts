import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { encode } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { allowLoginAttempt, clientIpOf } from '@/lib/auth/app-rate-limit'
import { HANDOFF_SESSION_MS, peekHandoff, takeHandoff, type HandoffEntry } from '@/lib/auth/web-handoff'
import { createAgentMemberToken } from '@/lib/agentMemberAuth'
import { describeCaughtError } from '@/lib/log-mask'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const gone = () => NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE })

async function holderOf(e: HandoffEntry) {
  if (e.who.type === 'owner') {
    const u = await prisma.user.findUnique({ where: { id: e.who.userId }, select: { id: true, email: true, name: true } })
    return u?.email ? { kind: 'owner' as const, email: u.email, user: u } : null
  }
  const m = await prisma.agentMember.findUnique({ where: { id: e.who.memberId }, select: { id: true, agentAgentId: true, email: true, displayName: true, authMethod: true, status: true } })
  return m && m.status === 'active' && m.agentAgentId === e.who.agentId ? { kind: 'member' as const, email: m.email, member: m } : null
}

function sameSiteJson(req: NextRequest): boolean {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return false
  const site = req.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin'
}

export async function POST(req: NextRequest) {
  try {
    if (!sameSiteJson(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
    const ip = clientIpOf(req.headers) ?? 'unknown'
    if (!allowLoginAttempt(`redeem:${ip}`, null, 'handoff').ok) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429, headers: NO_STORE })
    let body: { code?: unknown; peek?: unknown } | null
    try { body = await req.json() } catch { body = null }
    if (body?.peek === true) {
      const e = peekHandoff(body.code)
      const h = e && (await holderOf(e))
      return h && e ? NextResponse.json({ kind: h.kind, email: h.email, agentId: e.agentId, path: e.path }, { headers: NO_STORE }) : gone()
    }
    const e = takeHandoff(body?.code)
    const h = e && (await holderOf(e))
    if (!e || !h) return gone()
    const until = Date.now() + HANDOFF_SESSION_MS
    if (h.kind === 'member') {
      const { token, expiresAt } = createAgentMemberToken({ agentId: h.member.agentAgentId, memberId: h.member.id, email: h.member.email, expiresInSeconds: Math.floor(HANDOFF_SESSION_MS / 1000) })
      return NextResponse.json({
        kind: 'member', email: h.email, agentId: e.agentId, path: e.path, token, expiresAt,
        member: { id: h.member.id, email: h.member.email, displayName: h.member.displayName, authMethod: h.member.authMethod },
      }, { headers: NO_STORE })
    }
    const maxAge = Math.floor(HANDOFF_SESSION_MS / 1000)
    const token = await encode({ token: { sub: h.user.id, id: h.user.id, email: h.user.email, name: h.user.name, handoffUntil: until }, secret: process.env.NEXTAUTH_SECRET!, maxAge })
    const jar = await cookies()
    jar.set('next-auth.session-token', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: false, maxAge })
    if ((process.env.NEXTAUTH_URL || '').startsWith('https://')) jar.set('__Secure-next-auth.session-token', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: true, maxAge })
    return NextResponse.json({ kind: 'owner', email: h.email, agentId: e.agentId, path: e.path }, { headers: NO_STORE })
  } catch (err) {
    console.error('[web-handoff] redeem', describeCaughtError(err))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500, headers: NO_STORE })
  }
}

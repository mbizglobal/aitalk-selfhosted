import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData } from '@/lib/encryption'
import { getConnectionSecret } from '@/lib/secret-vault'
import { describeCaughtError } from '@/lib/log-mask'
import { CompanyDbError, DB_PROVIDER, DB_TLS_MODES, engineOfProvider, isDbEngine, parseDbCa, parseDbServiceConfig, readCompanyDb, type DbConnConfig } from '@/lib/work/company-db'

type Session = { user?: { id?: string } } | null
const LIMIT = { host: 255, database: 128, user: 128, password: 1000, label: 200 }

async function userOf(): Promise<string | null> {
  const s = (await getServerSession(authOptions as never)) as Session
  return s?.user?.id ?? null
}
async function ownsAgent(userId: string, agentId: unknown): Promise<boolean> {
  if (typeof agentId !== 'string' || !agentId) return false
  return !!(await prisma.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } }))
}

function parseForm(b: Record<string, unknown>): { ok: true; v: Omit<DbConnConfig, 'password'> & { password: string | null } } | { ok: false; error: string } {
  if (!isDbEngine(b.engine)) return { ok: false, error: 'Unknown database type' }
  const host = typeof b.host === 'string' ? b.host.trim() : ''
  if (!host || host.length > LIMIT.host || /\s|\//.test(host)) return { ok: false, error: 'Enter a host name or IP address' }
  const port = Number(b.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1–65535' }
  const database = typeof b.database === 'string' ? b.database.trim() : ''
  if (!database || database.length > LIMIT.database) return { ok: false, error: 'Enter a database name' }
  const user = typeof b.user === 'string' ? b.user.trim() : ''
  if (!user || user.length > LIMIT.user) return { ok: false, error: 'Enter a user name' }
  if (b.password !== undefined && b.password !== null && (typeof b.password !== 'string' || b.password.length > LIMIT.password)) return { ok: false, error: 'Password is too long' }
  const tls = (DB_TLS_MODES as readonly unknown[]).includes(b.tls) ? (b.tls as DbConnConfig['tls']) : 'verify'
  const caRaw = typeof b.ca === 'string' ? b.ca.trim() : ''
  const ca = caRaw ? parseDbCa(caRaw) : null
  if (caRaw && !ca) return { ok: false, error: 'CA certificate must be PEM text (-----BEGIN CERTIFICATE----- …)' }
  return { ok: true, v: { engine: b.engine, host, port, database, user, tls, ...(ca ? { ca } : {}), password: typeof b.password === 'string' && b.password !== '' ? b.password : null } }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await userOf()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const agentId = request.nextUrl.searchParams.get('agentId')
    const connectionId = request.nextUrl.searchParams.get('connectionId')
    if (!(await ownsAgent(userId, agentId)) || !connectionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const c = await prisma.workflowConnection.findFirst({
      where: { id: connectionId, agentId: agentId!, userId, provider: { in: Object.values(DB_PROVIDER) } },
      select: { id: true, provider: true, label: true, serviceConfig: true, encryptedToken: true, status: true },
    })
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const cfg = parseDbServiceConfig(c.serviceConfig)
    return NextResponse.json({
      connectionId: c.id,
      engine: engineOfProvider(c.provider),
      label: c.label,
      ...(cfg ?? {}),
      hasPassword: !!c.encryptedToken,
      active: c.status === 'active',
    })
  } catch (error) {
    console.error('[db-connection] GET:', describeCaughtError(error))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await userOf()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if (!(await ownsAgent(userId, body.agentId))) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    const agentId = body.agentId as string
    const form = parseForm(body)
    if (!form.ok) return NextResponse.json({ error: form.error }, { status: 400 })
    const v = form.v
    const provider = DB_PROVIDER[v.engine]

    if (body.test === true) {
      let password = v.password
      const testLabel = typeof body.label === 'string' ? body.label.trim() : ''
      if (password === null && testLabel) {
        const c = await prisma.workflowConnection.findFirst({ where: { agentId, userId, provider, label: testLabel }, select: { id: true, userId: true, encryptedToken: true, authType: true } })
        if (c?.encryptedToken) password = await getConnectionSecret(prisma, c.userId, c.id, c.encryptedToken, c.authType)
      }
      try {
        await readCompanyDb({ ...v, password: password ?? '' }, { sql: 'SELECT 1 AS ok', values: [], maxRows: 1 })
        return NextResponse.json({ ok: true })
      } catch (e) {
        if (e instanceof CompanyDbError) {
          console.warn(`[db-connection] test ${e.code}: ${e.detail.slice(0, 200)}`)
          return NextResponse.json({ ok: false, code: e.code })
        }
        throw e
      }
    }

    const label = typeof body.label === 'string' ? body.label.trim() : ''
    if (!label || label.length > LIMIT.label) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const serviceConfig = JSON.stringify({ host: v.host, port: v.port, database: v.database, user: v.user, tls: v.tls, ...(v.ca ? { ca: v.ca } : {}) })
    const description = `${v.host}/${v.database}`.slice(0, 300)
    const encryptedToken = v.password === null ? undefined : await encryptData(v.password)
    const saved = await prisma.workflowConnection.upsert({
      where: { agentId_provider_label: { agentId, provider, label } },
      update: { serviceConfig, description, ...(encryptedToken ? { encryptedToken } : {}), status: 'active', errorMessage: null },
      create: { userId, agentId, provider, label, description, transport: 'rest_api', authType: 'api_key', serviceConfig, encryptedToken: encryptedToken ?? null, status: 'active' },
      select: { id: true, userId: true },
    })
    if (saved.userId !== userId) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    return NextResponse.json({ connectionId: saved.id })
  } catch (error) {
    console.error('[db-connection] POST:', describeCaughtError(error))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


export async function DELETE(request: NextRequest) {
  try {
    const userId = await userOf()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const agentId = request.nextUrl.searchParams.get('agentId')
    const connectionId = request.nextUrl.searchParams.get('connectionId')
    if (!(await ownsAgent(userId, agentId)) || !connectionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const r = await prisma.workflowConnection.deleteMany({ where: { id: connectionId, agentId: agentId!, userId, provider: { in: Object.values(DB_PROVIDER) } } })
    if (!r.count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[db-connection] DELETE:', describeCaughtError(error))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

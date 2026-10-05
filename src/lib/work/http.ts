
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WORK_ERROR_STATUS, WorkError } from './errors'
import { defaultWorkFileDeps, type WorkFileDeps } from './files'
import { resolveWorkOwner, resolveWorkTeamAccess, type WorkTeamAccess } from './team-access'

export interface WorkRouteCtx {
  access: WorkTeamAccess
  deps: WorkFileDeps
}

type Params = Record<string, string>

export function workRoute<P extends Params & { agentId: string }>(
  stage: string,
  handler: (req: NextRequest, ctx: WorkRouteCtx, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, { params }: { params: Promise<P> }) => {
    try {
      const p = await params
      const access = await resolveWorkTeamAccess(req, p.agentId)
      if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      const out = await handler(req, { access, deps: await defaultWorkFileDeps() }, p)
      return NextResponse.json(out ?? { ok: true })
    } catch (e) {
      if (e instanceof WorkError) return workErrorResponse(e)
      console.error(`[work-api] ${stage}`, describeCaughtError(e))
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
    }
  }
}

export function workErrorResponse(e: WorkError) {
  if (e.stop) return NextResponse.json({ error: e.code, stop: e.stop }, { status: WORK_ERROR_STATUS[e.code] })
  return NextResponse.json({ error: e.code, detail: e.detail || undefined }, { status: WORK_ERROR_STATUS[e.code] })
}

export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown
  try { body = await req.json() } catch { throw new WorkError('INVALID', 'body must be JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkError('INVALID', 'body must be an object')
  return body as Record<string, unknown>
}

export function workOwnerRoute<P extends Params>(
  stage: string,
  handler: (req: NextRequest, ctx: { userId: string; deps: WorkFileDeps }, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, { params }: { params: Promise<P> }) => {
    try {
      const userId = await resolveWorkOwner()
      if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      const out = await handler(req, { userId, deps: await defaultWorkFileDeps() }, await params)
      return NextResponse.json(out ?? { ok: true })
    } catch (e) {
      if (e instanceof WorkError) return workErrorResponse(e)
      console.error(`[work-api] ${stage}`, describeCaughtError(e))
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
    }
  }
}

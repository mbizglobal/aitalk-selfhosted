
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { builtinSheetTemplates } from '@/lib/work/registry'
import { importBackup, IMPORT_MAX_BYTES } from '@/lib/work/backup-import'
import { workStorageRegion } from '@/lib/work/files'
import { uploadToBlob } from '@/lib/managed/blob-storage'
import { restoreWorkAppCanvas } from '@/lib/workflow/service'

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    let form: FormData
    try { form = await req.formData() } catch { return NextResponse.json({ error: 'INVALID', detail: 'multipart form with a ZIP file is required' }, { status: 400 }) }
    const file = form.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'INVALID', detail: 'file is required' }, { status: 400 })
    if (file.size > IMPORT_MAX_BYTES) return NextResponse.json({ error: 'BACKUP_TOO_LARGE' }, { status: 413 })
    const wanted = typeof form.get('agentId') === 'string' ? (form.get('agentId') as string) : ''
    const agent = wanted
      ? await prisma.agent.findFirst({ where: { agentId: wanted, userId }, select: { agentId: true } })
      : (await prisma.agent.findFirst({ where: { defaultOwnerId: userId }, select: { agentId: true } })) ?? await prisma.agent.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { agentId: true } })
    if (!agent) return NextResponse.json({ error: 'NO_AGENT' }, { status: 409 })
    const r = await importBackup({
      db: prisma, dataKey: ensureUserDataKey, templates: builtinSheetTemplates(),
      region: (u) => workStorageRegion(prisma, u),
      upload: async (region, path, data) => { await uploadToBlob(region, path, data, 'application/octet-stream') },
    }, { userId, agentId: agent.agentId, zip: new Uint8Array(await file.arrayBuffer()) })
    const canvas = await restoreWorkAppCanvas({ userId, projectId: r.projectId, nodeData: { ...r.node, label: (r.node.label as string) || r.name } })
    return NextResponse.json({ ok: true, projectId: r.projectId, name: r.name, workflowId: canvas.ok ? canvas.workflowId : null, restoreError: canvas.ok ? null : canvas.code })
  } catch (e) {
    if (e instanceof WorkError && (e.code === 'INVALID' || e.code === 'STALE')) {
      return NextResponse.json({ error: e.code === 'STALE' ? 'IMPORT_TIMEOUT' : 'BACKUP_INVALID', detail: e.detail?.slice(0, 200) ?? null }, { status: 400 })
    }
    console.error('[work-projects] import', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}

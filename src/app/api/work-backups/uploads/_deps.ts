import { prisma } from '@/lib/prisma'
import { workStorageRegion } from '@/lib/work/files'
import { deleteFromBlob, downloadFromBlob, uploadToBlob } from '@/lib/managed/blob-storage'
import type { UploadDeps } from '@/lib/work/backup-upload'
import type { RestoreDeps } from '@/lib/work/backup-restore'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { builtinSheetTemplates } from '@/lib/work/registry'
import { restoreWorkAppCanvas, restoreWorkAppOriginalTx, restoreWorkAppSetCanvas } from '@/lib/workflow/service'

export const uploadDeps: UploadDeps = {
  db: prisma,
  region: (u) => workStorageRegion(prisma, u),
  upload: async (region, path, data) => { await uploadToBlob(region, path, data, 'application/octet-stream') },
  download: (region, path) => downloadFromBlob(region, path),
  deleteBlob: (region, path) => deleteFromBlob(region, path),
}

export const restoreDeps: RestoreDeps = {
  db: prisma,
  dataKey: ensureUserDataKey,
  templates: builtinSheetTemplates(),
  region: (u) => workStorageRegion(prisma, u),
  upload: async (region, path, data) => { await uploadToBlob(region, path, data, 'application/octet-stream') },
  download: (region, path) => downloadFromBlob(region, path),
  restoreCanvas: async (i) => { const r = await restoreWorkAppCanvas(i); return r.ok ? { ok: true, workflowId: r.workflowId } : { ok: false, code: r.code } },
  restoreSetCanvas: async (i) => { const r = await restoreWorkAppSetCanvas(i); return r.ok ? { ok: true, workflowId: r.workflowId } : { ok: false, code: r.code } },
  originalTx: async (i) => { const r = await restoreWorkAppOriginalTx(i); return r.ok ? r : { ok: false, code: r.code, message: r.message } },
}


import type { Prisma } from '@prisma/client'
import { encryptJson } from './sealed'

type Tx = Prisma.TransactionClient

export const SIGNAL_KINDS = ['sealed', 'resubmitted', 'unlocked', 'inbox_row', 'task_deleted', 'project_deleted', 'send_sent'] as const
export const DELETION_SIGNAL_KINDS = ['task_deleted', 'project_deleted'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export async function writeWorkSignal(tx: Tx, key: Buffer, s: { userId: string; projectId: string; taskId: string; kind: SignalKind; submissionNumber?: number | null }): Promise<void> {
  const task = await tx.workTask.findUniqueOrThrow({ where: { id: s.taskId }, select: { title: true, periodStart: true, periodEnd: true } })
  const project = await tx.workProject.findUniqueOrThrow({ where: { id: s.projectId }, select: { workflowId: true } })
  await tx.workSignal.create({
    data: {
      userId: s.userId, projectId: s.projectId, taskId: s.taskId, appWorkflowId: project.workflowId ?? null,
      kind: s.kind, submissionNumber: s.submissionNumber ?? null,
      periodStart: day(task.periodStart), periodEnd: day(task.periodEnd),
      payload: encryptJson({ title: task.title }, key),
    },
  })
}

export async function writeInboxSignal(tx: Tx, key: Buffer, s: { userId: string; projectId: string; title: string; rowId: string; family: string; fromWorkflowId?: string }): Promise<void> {
  const project = await tx.workProject.findUniqueOrThrow({ where: { id: s.projectId }, select: { workflowId: true } })
  await tx.workSignal.create({
    data: {
      userId: s.userId, projectId: s.projectId, taskId: null, appWorkflowId: project.workflowId ?? null,
      kind: 'inbox_row', submissionNumber: null, periodStart: null, periodEnd: null,
      payload: encryptJson({ title: s.title, rowId: s.rowId, family: s.family, ...(s.fromWorkflowId ? { fromWorkflowId: s.fromWorkflowId } : {}) }, key),
    },
  })
}

export async function writeDeletionSignal(tx: Tx, key: Buffer, s: { userId: string; projectId: string; taskId?: string; workflowId: string | null }): Promise<void> {
  await tx.workSignal.create({
    data: {
      userId: s.userId, projectId: s.projectId, taskId: s.taskId ?? null, appWorkflowId: s.workflowId,
      kind: s.taskId ? 'task_deleted' : 'project_deleted', submissionNumber: null, periodStart: null, periodEnd: null,
      payload: encryptJson({}, key),
    },
  })
}

export async function writeSendSignal(tx: Tx, key: Buffer, s: { userId: string; projectId: string; workflowId: string; sendId: string; ref: string; sentAt: string; how: 'mail' | 'manual'; attachFileIds?: readonly string[] }): Promise<void> {
  await tx.workSignal.create({
    data: {
      userId: s.userId, projectId: s.projectId, taskId: null, appWorkflowId: s.workflowId,
      kind: 'send_sent', submissionNumber: null, periodStart: null, periodEnd: null,
      payload: encryptJson({ sendId: s.sendId, ref: s.ref, sentAt: s.sentAt, how: s.how, ...(s.attachFileIds ? { attachFileIds: s.attachFileIds } : {}) }, key),
    },
  })
}

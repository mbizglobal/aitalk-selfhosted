
type Db = {
  memberLearningState: { deleteMany(args: any): Promise<{ count: number }> }
  conversation: { deleteMany(args: any): Promise<{ count: number }> }
  miniAppResult: { deleteMany(args: any): Promise<{ count: number }> }
  agentMemberPasswordResetToken: { deleteMany(args: any): Promise<{ count: number }> }
  agentMemberEmailChangeToken: { deleteMany(args: any): Promise<{ count: number }> }
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>
}

export const PAYLOAD_DETACH_SQL =
  `UPDATE "mini_app_payloads" SET "subject_id" = 'del:' || "payload_id" ` +
  `WHERE "subject_type" = 'member' AND "subject_id" = ANY($1)`

export interface MemberPurgeResult {
  learningStates: number
  quizHistoryRows: number
  results: number
  payloadsDetached: number
  passwordResetTokens: number
  emailChangeTokens: number
}

export function detachedSubjectId(payloadId: string): string {
  return `del:${payloadId}`
}

export function memberLookupWhere(userEmail: string | null | undefined, userId: string) {
  const or: Array<Record<string, string>> = [{ credentialRef: `oauth:google:${userId}` }]
  if (userEmail && !userEmail.includes('@anonymized.local')) {
    or.push({ email: userEmail })
  }
  return { OR: or }
}

export async function lockSeatsForAccountDeletion(
  tx: any,
  lock: (tx: any, agentId: string) => Promise<unknown>,
  agentIds: string[]
): Promise<string[]> {
  const unique = Array.from(new Set(agentIds.filter(Boolean))).sort()
  for (const agentId of unique) {
    await lock(tx, agentId)
  }
  return unique
}

export function quizMemberClientId(memberId: number | string): string {
  return `quiz-member:${memberId}`
}

export async function purgeMemberPersonalData(
  db: Db,
  memberIds: number[]
): Promise<MemberPurgeResult> {
  const empty: MemberPurgeResult = {
    learningStates: 0,
    quizHistoryRows: 0,
    results: 0,
    payloadsDetached: 0,
    passwordResetTokens: 0,
    emailChangeTokens: 0,
  }
  if (memberIds.length === 0) return empty

  const subjectIds = memberIds.map((id) => String(id))
  const clientIds = memberIds.map((id) => quizMemberClientId(id))

  const learningStates = await db.memberLearningState.deleteMany({
    where: { subjectType: 'member', subjectId: { in: subjectIds } },
  })

  const quizHistory = await db.conversation.deleteMany({
    where: { model: 'miniapp-quiz', client_id: { in: clientIds } },
  })

  const results = await db.miniAppResult.deleteMany({
    where: { subjectType: 'member', subjectId: { in: subjectIds } },
  })

  const payloadsDetached = await db.$executeRawUnsafe(PAYLOAD_DETACH_SQL, subjectIds)

  const passwordResetTokens = await db.agentMemberPasswordResetToken.deleteMany({
    where: { memberId: { in: memberIds } },
  })
  const emailChangeTokens = await db.agentMemberEmailChangeToken.deleteMany({
    where: { memberId: { in: memberIds } },
  })

  return {
    learningStates: learningStates.count,
    quizHistoryRows: quizHistory.count,
    results: results.count,
    payloadsDetached,
    passwordResetTokens: passwordResetTokens.count,
    emailChangeTokens: emailChangeTokens.count,
  }
}

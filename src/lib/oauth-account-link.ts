
export type OauthAccountLinkResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: 'owned_by_other' }
  | { ok: false; reason: 'transient_conflict' }

export type OauthAccountTokens = {
  access_token?: string | null
  refresh_token?: string | null
  expires_at?: number | null
  token_type?: string | null
  scope?: string | null
  id_token?: string | null
  session_state?: string | null
}

const TOKEN_FIELDS = [
  'access_token',
  'refresh_token',
  'expires_at',
  'token_type',
  'scope',
  'id_token',
  'session_state',
] as const

function pickTokenFields(tokens: OauthAccountTokens): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const key of TOKEN_FIELDS) {
    const value = (tokens as Record<string, unknown>)[key]
    if (value !== undefined) data[key] = value
  }
  return data
}

type AccountDelegate = {
  update(args: any): Promise<{ id: string }>
  create(args: any): Promise<{ id: string }>
  findUnique(args: any): Promise<{ userId: string } | null>
}

const MAX_ATTEMPTS = 3

async function updateIfOwned(
  account: AccountDelegate,
  provider: string,
  providerAccountId: string,
  userId: string,
  data: Record<string, unknown>
): Promise<string | null> {
  try {
    const row = await account.update({
      where: { provider_providerAccountId: { provider, providerAccountId }, userId },
      data,
      select: { id: true },
    })
    return row.id
  } catch (e: any) {
    if (e?.code === 'P2025') return null
    throw e
  }
}

export async function linkOauthAccountOwnedBy(
  account: AccountDelegate,
  params: {
    provider: string
    providerAccountId: string
    userId: string
    tokens: OauthAccountTokens
  }
): Promise<OauthAccountLinkResult> {
  const { provider, providerAccountId, userId } = params
  const data = pickTokenFields(params.tokens)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const updatedId = await updateIfOwned(account, provider, providerAccountId, userId, data)
    if (updatedId) return { ok: true, accountId: updatedId }

    try {
      const created = await account.create({
        data: { ...data, userId, type: 'oauth', provider, providerAccountId },
        select: { id: true },
      })
      return { ok: true, accountId: created.id }
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e
    }

    const current = await account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: { userId: true },
    })
    if (current && current.userId !== userId) {
      return { ok: false, reason: 'owned_by_other' }
    }
  }

  return { ok: false, reason: 'transient_conflict' }
}

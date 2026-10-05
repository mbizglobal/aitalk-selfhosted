const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

interface FcmServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}
interface SendResult {
  ok: boolean
  status: 'sent' | 'failed' | 'invalid_token'
  errorDetail?: string
}
export async function loadFcmConfig(): Promise<FcmServiceAccount | null> {
  return null
}
export async function getAccessToken(_sa: FcmServiceAccount): Promise<string> {
  return unavailable('Mobile push')
}
export async function sendToToken(
  _sa: FcmServiceAccount, _accessToken: string, _fcmToken: string,
  _notification: { title: string; body: string }, _data: Record<string, string>,
  _androidOpts?: { channelId?: string; icon?: string; tag?: string },
): Promise<SendResult> {
  return unavailable('Mobile push')
}

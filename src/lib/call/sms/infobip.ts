
export type InfobipRawResult =
  | { kind: 'response'; httpStatus: number; json: unknown }
  | { kind: 'error'; timeout: boolean; message: string }

export interface InfobipAccount { apiKey: string; baseUrl: string; sender: string }

export async function infobipSendRaw(_a: InfobipAccount, _to: string, _message: string, _messageId: string, _fetchImpl?: (url: string, init: RequestInit) => Promise<Response>): Promise<InfobipRawResult> {
  return { kind: 'error', timeout: false, message: 'SMS is not available in self-hosted' }
}

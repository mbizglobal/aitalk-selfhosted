
import { SecretClient } from '@azure/keyvault-secrets'
import { DefaultAzureCredential } from '@azure/identity'

const CACHE_TTL_MS = 5 * 60 * 1000
let cachedMasterKey: Buffer | null = null
let cacheExpiry = 0

let secretClient: SecretClient | null = null

function getSecretClient(): SecretClient {
  if (!secretClient) {
    const vaultUrl = process.env.AZURE_KEYVAULT_URL
    if (!vaultUrl) {
      throw new Error('AZURE_KEYVAULT_URL is not set in environment variables.')
    }
    const credential = new DefaultAzureCredential()
    secretClient = new SecretClient(vaultUrl, credential)
  }
  return secretClient
}

export async function getMasterKeyFromKMS(): Promise<Buffer> {
  const now = Date.now()

  if (cachedMasterKey && now < cacheExpiry) {
    return cachedMasterKey
  }

  const secretName = process.env.AZURE_KEYVAULT_SECRET_NAME
  if (!secretName) {
    throw new Error('AZURE_KEYVAULT_SECRET_NAME is not set in environment variables.')
  }

  const client = getSecretClient()
  const secret = await client.getSecret(secretName)

  if (!secret.value) {
    throw new Error('Key Vault secret returned empty value.')
  }

  cachedMasterKey = Buffer.from(secret.value, 'hex')
  cacheExpiry = now + CACHE_TTL_MS

  return cachedMasterKey
}

export function isKMSEnabled(): boolean {
  return !!(process.env.AZURE_KEYVAULT_URL && process.env.AZURE_KEYVAULT_SECRET_NAME)
}

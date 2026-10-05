import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { RAGProviderType } from '@/lib/rag-providers/types'

const PINECONE_EMBEDDING_MODELS = ['llama-text-embed-v2', 'multilingual-e5-large', 'pinecone-sparse-english-v0']

export interface DecryptedUserKeys {
  userApiKey: string
  pineconeConfig: {
    apiKey: string
    indexName: string
    host?: string
    embeddingModel: string
    dimension: number
  } | null
}

export class UserApiKeyError extends Error {
  constructor(public code: 'NOT_CONFIGURED' | 'DECRYPT_FAILED' | 'MISSING_OPENAI_FOR_PINECONE', message: string) {
    super(message)
    this.name = 'UserApiKeyError'
  }
}

// User from prisma.user.findUnique with relations { zki, aiProviders, ragProviders }
export async function decryptUserApiKey(
  user: any,
  ragProvider: RAGProviderType,
  isManaged: boolean,
): Promise<DecryptedUserKeys> {
  if (ragProvider === 'azure_ai_search' && isManaged) {
    return { userApiKey: '', pineconeConfig: null }
  }

  if (!user || !user.encryptedDataKey) {
    throw new UserApiKeyError('NOT_CONFIGURED', 'User configuration not found')
  }

  const getDek = async () => {
    if (user.zkiId && user.zki?.masterKey) {
      return decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey!), user.zki.masterKey)
    }
    return await decryptDataKey(Buffer.from(user.encryptedDataKey!))
  }

  try {
    if (ragProvider === 'pinecone') {
      if (!user.ragProviders?.providers) {
        throw new UserApiKeyError('NOT_CONFIGURED', 'Pinecone not configured')
      }
      const ragProvidersConfig = JSON.parse(user.ragProviders.providers)
      const pinecone = ragProvidersConfig.pinecone
      if (!pinecone?.apiKey || !pinecone?.indexName) {
        throw new UserApiKeyError('NOT_CONFIGURED', 'Pinecone API Key / Index Name missing')
      }

      const embeddingModel = pinecone.embeddingModel || 'llama-text-embed-v2'
      const isPineconeEmbedding = PINECONE_EMBEDDING_MODELS.includes(embeddingModel)

      const pineconeConfig = {
        apiKey: pinecone.apiKey,
        indexName: pinecone.indexName,
        host: pinecone.host,
        embeddingModel,
        dimension: pinecone.dimension || 1024,
      }

      let userApiKey = ''
      if (!isPineconeEmbedding) {
        if (!user.aiProviders?.providers) {
          throw new UserApiKeyError('MISSING_OPENAI_FOR_PINECONE', 'OpenAI API key required for OpenAI embedding')
        }
        const aiProvidersConfig = JSON.parse(user.aiProviders.providers)
        if (!aiProvidersConfig.openai?.apiKey) {
          throw new UserApiKeyError('MISSING_OPENAI_FOR_PINECONE', 'OpenAI API key required for OpenAI embedding')
        }
        const dek = await getDek()
        userApiKey = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, 'base64'), dek)
      }

      return { userApiKey, pineconeConfig }
    }

    if (!user.aiProviders?.providers) {
      throw new UserApiKeyError('NOT_CONFIGURED', 'API key not configured')
    }
    const requiredLlmProvider = ragProvider === 'gemini_file_search' ? 'gemini' : 'openai'
    const providersConfig = JSON.parse(user.aiProviders.providers)
    const providerApiKey = providersConfig[requiredLlmProvider]?.apiKey
    if (!providerApiKey) {
      const providerName = requiredLlmProvider === 'gemini' ? 'Gemini' : 'OpenAI'
      throw new UserApiKeyError('NOT_CONFIGURED', `${providerName} API key not configured`)
    }
    const dek = await getDek()
    const userApiKey = decrypt(Buffer.from(providerApiKey, 'base64'), dek)
    return { userApiKey, pineconeConfig: null }
  } catch (err) {
    if (err instanceof UserApiKeyError) throw err
    throw new UserApiKeyError('DECRYPT_FAILED', 'Failed to decrypt API key')
  }
}

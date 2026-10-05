
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { ensureUserDataKey } from '@/lib/user-data-key';
import type { ParsedResponse } from '../response-parser';
import type { ActionHandler, ActionContext, ActionResult } from '../action-registry';

const DIMENSION_MAP: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'llama-text-embed-v2': 1024,
  'multilingual-e5-large': 1024,
};

export class SettingsActionHandler implements ActionHandler {
  private static SERVER_ACTIONS = [
    'update_pinecone_config',
    'set_rag_provider',
    'update_profile',
    'delete_api_key',
    'save_api_key',
  ];

  canHandle(parsed: ParsedResponse): boolean {
    return parsed.type === 'settings_action'
      && !!parsed.action
      && SettingsActionHandler.SERVER_ACTIONS.includes(parsed.action);
  }

  async execute(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    switch (parsed.action) {
      case 'update_pinecone_config':
        return this.updatePineconeConfig(parsed, context);
      case 'set_rag_provider':
        return this.setRagProvider(parsed, context);
      case 'update_profile':
        return this.updateProfile(parsed, context);
      case 'delete_api_key':
        return this.deleteApiKey(parsed, context);
      case 'save_api_key':
        return this.saveApiKey(parsed, context);
      default:
        return {
          type: 'settings_action',
          action: parsed.action,
          provider: parsed.provider,
          message: parsed.message || 'Settings action',
        };
    }
  }

  private async updatePineconeConfig(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    if (!parsed.value) {
      return {
        type: 'settings_action',
        action: 'update_pinecone_config',
        message: parsed.message || 'Missing config value.',
      };
    }

    try {
      const configValue = { ...parsed.value };
      delete configValue.apiKey;

      const existingRag = await prisma.ragProviders.findUnique({
        where: { id: context.userId },
        select: { providers: true, defaultProvider: true }
      });
      let providersToSave: any = {};
      if (existingRag?.providers) {
        try {
          providersToSave = typeof existingRag.providers === 'string'
            ? JSON.parse(existingRag.providers)
            : existingRag.providers;
        } catch { providersToSave = {}; }
      }

      const existingPinecone = providersToSave.pinecone || {};
      const embeddingModel = configValue.embeddingModel || existingPinecone.embeddingModel || 'llama-text-embed-v2';
      const dimension = DIMENSION_MAP[embeddingModel] || existingPinecone.dimension || 1024;

      providersToSave = {
        ...providersToSave,
        pinecone: {
          ...existingPinecone,
          host: configValue.host ?? existingPinecone.host ?? '',
          indexName: configValue.indexName ?? existingPinecone.indexName ?? '',
          namespace: configValue.namespace ?? existingPinecone.namespace ?? '',
          embeddingModel,
          dimension,
        }
      };

      const newDefaultProvider = (!existingRag?.defaultProvider || existingRag.defaultProvider === 'none')
        ? 'pinecone' : existingRag.defaultProvider;

      await prisma.ragProviders.upsert({
        where: { id: context.userId },
        update: { defaultProvider: newDefaultProvider, providers: JSON.stringify(providersToSave), updatedAt: new Date() },
        create: { id: context.userId, defaultProvider: newDefaultProvider, providers: JSON.stringify(providersToSave) },
      });

      return {
        type: 'settings_action',
        action: 'update_pinecone_config',
        value: configValue,
        message: parsed.message || 'Pinecone config updated.',
      };
    } catch (err) {
      console.error('[SettingsAction] Failed to update pinecone config:', err);
      return {
        type: 'settings_action',
        action: 'update_pinecone_config',
        message: 'Failed to update Pinecone config.',
      };
    }
  }

  private async setRagProvider(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    if (!parsed.value) {
      return {
        type: 'settings_action',
        action: 'set_rag_provider',
        message: parsed.message || 'Missing provider value.',
      };
    }

    try {
      const validRagProviders = ['none', 'openai_vector_store', 'gemini_file_search', 'pinecone'];
      if (validRagProviders.includes(parsed.value)) {
        await prisma.ragProviders.upsert({
          where: { id: context.userId },
          update: { defaultProvider: parsed.value, updatedAt: new Date() },
          create: { id: context.userId, defaultProvider: parsed.value, providers: '{}' },
        });

        return {
          type: 'settings_action',
          action: 'set_rag_provider',
          value: parsed.value,
          message: parsed.message || 'RAG provider updated.',
        };
      }
    } catch (err) {
      console.error('[SettingsAction] Failed to set RAG provider:', err);
    }

    return {
      type: 'settings_action',
      action: 'set_rag_provider',
      message: 'Failed to set RAG provider.',
    };
  }

  private async updateProfile(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    if (!parsed.value) {
      return {
        type: 'settings_action',
        action: 'update_profile',
        message: parsed.message || 'Missing profile value.',
      };
    }

    try {
      const profileValue = parsed.value;

      const userUpdateData: any = { updatedAt: new Date() };
      if (profileValue.name) {
        userUpdateData.name = profileValue.name;
      }
      if (profileValue.email) {
        const currentUser = await prisma.user.findUnique({
          where: { id: context.userId }, select: { password: true, email: true }
        });
        if (!currentUser?.password) {
          return {
            type: 'settings_action',
            action: 'update_profile',
            value: profileValue,
            message: 'Email cannot be changed for Google accounts.',
          };
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(profileValue.email)) {
          return {
            type: 'settings_action',
            action: 'update_profile',
            value: profileValue,
            message: 'Invalid email format.',
          };
        }
        if (profileValue.email !== currentUser.email) {
          const existingUser = await prisma.user.findUnique({ where: { email: profileValue.email } });
          if (existingUser) {
            return {
              type: 'settings_action',
              action: 'update_profile',
              value: profileValue,
              message: 'This email is already in use.',
            };
          }
        }
        userUpdateData.email = profileValue.email;
      }
      if (Object.keys(userUpdateData).length > 1) {
        await prisma.user.update({
          where: { id: context.userId },
          data: userUpdateData,
        });
      }

      if (profileValue.timezone || profileValue.locale || profileValue.timeFormat) {
        await prisma.settings.upsert({
          where: { id: context.userId },
          update: {
            ...(profileValue.timezone && { timezone: profileValue.timezone }),
            ...(profileValue.locale && { locale: profileValue.locale }),
            ...(profileValue.timeFormat && { time_format: profileValue.timeFormat }),
            updatedAt: new Date(),
          },
          create: {
            id: context.userId,
            timezone: profileValue.timezone || 'UTC',
            locale: profileValue.locale || 'en-US',
            time_format: profileValue.timeFormat || 'DD.MM.YYYY HH:mm',
          },
        });
      }

      return {
        type: 'settings_action',
        action: 'update_profile',
        value: profileValue,
        message: parsed.message || 'Profile updated.',
      };
    } catch (err) {
      console.error('[SettingsAction] Failed to update profile:', err);
      return {
        type: 'settings_action',
        action: 'update_profile',
        message: 'Failed to update profile.',
      };
    }
  }

  private async deleteApiKey(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    const provider = parsed.provider;
    if (!provider) {
      return { type: 'settings_action', action: 'delete_api_key', message: 'Missing provider.' };
    }

    try {
      const aiProviders = await prisma.aiProviders.findUnique({
        where: { id: context.userId },
        select: { providers: true, defaultProvider: true }
      });

      if (!aiProviders?.providers) {
        return { type: 'answer', message: `No API keys configured.` };
      }

      const providersConfig = typeof aiProviders.providers === 'string'
        ? JSON.parse(aiProviders.providers)
        : aiProviders.providers;

      const PROVIDER_KEY_MAP: Record<string, string> = {
        openai: 'openai', claude: 'claude', gemini: 'gemini',
        deepseek: 'deepseek', grok: 'xai', mistral: 'mistral',
      };
      const dbKey = PROVIDER_KEY_MAP[provider] || provider;

      if (!providersConfig[dbKey]) {
        return { type: 'answer', message: `${provider} API key is not configured.` };
      }

      delete providersConfig[dbKey];

      let newDefaultProvider = aiProviders.defaultProvider;
      if (newDefaultProvider === provider || newDefaultProvider === dbKey) {
        const remaining = Object.keys(providersConfig);
        newDefaultProvider = remaining[0] || '';
      }

      await prisma.aiProviders.update({
        where: { id: context.userId },
        data: {
          providers: JSON.stringify(providersConfig),
          defaultProvider: newDefaultProvider,
        }
      });

      const DISPLAY: Record<string, string> = {
        openai: 'OpenAI', claude: 'Claude', grok: 'Grok',
        gemini: 'Gemini', deepseek: 'DeepSeek', mistral: 'Mistral',
      };
      const displayName = DISPLAY[provider] || provider;

      return { type: 'answer', message: `${displayName} API key deleted.` };
    } catch (err) {
      console.error('[SettingsAction] Failed to delete API key:', err);
      return { type: 'answer', message: 'Failed to delete API key.' };
    }
  }

  private async saveApiKey(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    const provider = parsed.provider;
    const rawApiKey = parsed.value;
    if (!provider || !rawApiKey) {
      return { type: 'answer', message: 'Missing provider or API key.' };
    }

    const PROVIDER_KEY_MAP: Record<string, string> = {
      openai: 'openai', claude: 'claude', gemini: 'gemini',
      deepseek: 'deepseek', grok: 'xai', mistral: 'mistral',
    };
    const DISPLAY: Record<string, string> = {
      openai: 'OpenAI', claude: 'Claude', grok: 'Grok',
      gemini: 'Gemini', deepseek: 'DeepSeek', mistral: 'Mistral',
    };
    const dbKey = PROVIDER_KEY_MAP[provider] || provider;
    const displayName = DISPLAY[provider] || provider;

    try {
      const user = await prisma.user.findUnique({
        where: { id: context.userId },
        include: { aiProviders: true, zki: true }
      });
      if (!user) return { type: 'answer', message: 'User not found.' };

      const dataKey = await ensureUserDataKey(prisma, context.userId);

      const encryptedApiKey = encrypt(rawApiKey, dataKey).toString('base64');

      let providersConfig: Record<string, any> = {};
      if (user.aiProviders?.providers) {
        try { providersConfig = JSON.parse(user.aiProviders.providers); } catch { /* reset */ }
      }

      providersConfig[dbKey] = {
        apiKey: encryptedApiKey,
        updatedAt: new Date().toISOString()
      };

      await prisma.aiProviders.upsert({
        where: { id: context.userId },
        update: { providers: JSON.stringify(providersConfig) },
        create: { id: context.userId, providers: JSON.stringify(providersConfig), defaultProvider: provider },
      });

      return { type: 'answer', message: `${displayName} API key saved. ✅` };
    } catch (err) {
      console.error('[SettingsAction] Failed to save API key:', err);
      return { type: 'answer', message: 'Failed to save API key.' };
    }
  }
}

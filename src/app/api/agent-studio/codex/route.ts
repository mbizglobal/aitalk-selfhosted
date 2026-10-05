
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { getProviderApiKey } from "@/lib/secret-vault";
import {
  AIAssistantEngine,
  AI_ASSISTANT_PRICING,
  DEFAULT_MODELS,
  PROVIDER_KEY_MAP,
} from "@/lib/ai-assistant/engine";
import { getManagedAzureConfig } from "@/lib/managed/api-key";
import type { AIAssistantContext } from "@/lib/codex-lib/context-instructions";
import type { TemplateSource } from "@/lib/codex-lib";
import { replaceRetiredChatModel } from "@/lib/managed/model-lineup";
import { describeCaughtError } from "@/lib/log-mask";
import { VENDOR_DEV_HOSTS } from "@/lib/vendor-site";

const DEV_HOSTS = [...VENDOR_DEV_HOSTS, 'localhost', '127.0.0.1'];

function getTemplateSource(request: NextRequest): TemplateSource {
  const host = request.headers.get('host') || '';
  return DEV_HOSTS.some(devHost => host.includes(devHost)) ? 'local' : 'db';
}

const engine = new AIAssistantEngine();

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;
    if (!session || !session.user?.id) {
      return Response.json({ errorCode: "LOGIN_REQUIRED" }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await req.json() as {
      prompt: string;
      sessionId?: string;
      workflowId?: string;
      existingWorkflow?: { nodes: any[]; edges: any[] };
      model?: string;
      isFollowUp?: boolean;
      context?: AIAssistantContext;
      nodeId?: string;
      dataSheetId?: string;
      mcpConnectionId?: string;
      provider?: string;
      providerStatus?: Record<string, boolean>;
      agentId?: string;
    };

    if (!body.prompt || typeof body.prompt !== 'string') {
      return Response.json({ errorCode: "PROMPT_REQUIRED" }, { status: 400 });
    }

    const selectedProvider = body.provider && AI_ASSISTANT_PRICING[body.provider] ? body.provider : 'openai';
    const validModels = Object.keys(AI_ASSISTANT_PRICING[selectedProvider] || {});
    const defaultModel = DEFAULT_MODELS[selectedProvider] || validModels[0];
    const requestedModel = typeof body.model === 'string' && body.model && !validModels.includes(body.model)
      ? replaceRetiredChatModel(body.model)
      : body.model;
    const selectedModel = requestedModel && validModels.includes(requestedModel) ? requestedModel : defaultModel;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        aiProviders: true,
        zki: true,
        subscription: { select: { serviceVariant: true, managedRegion: true } }
      }
    });

    if (!user) {
      return Response.json({ errorCode: "USER_NOT_FOUND" }, { status: 404 });
    }

    const isManaged = user.subscription?.serviceVariant === 'managed';
    let apiKey: string;
    let azureConfig: { endpoint: string; apiVersion: string } | undefined;

    if (isManaged) {
      const region = user.subscription?.managedRegion;
      if (!region) {
        return Response.json(
          { errorCode: "GENERATION_FAILED", detail: "Managed region not configured" },
          { status: 400 }
        );
      }
      try {
        const config = await getManagedAzureConfig(region);
        apiKey = config.apiKey;
        azureConfig = { endpoint: config.endpoint, apiVersion: config.apiVersion };
      } catch (error: any) {
        return Response.json(
          { errorCode: "GENERATION_FAILED", detail: "Managed service is not available for this region." },
          { status: 500 }
        );
      }
    } else {
      if (!user.aiProviders?.providers || !user.encryptedDataKey) {
        return Response.json(
          { errorCode: "API_KEY_NOT_SET", provider: selectedProvider.toUpperCase() },
          { status: 400 }
        );
      }

      const providerKey = PROVIDER_KEY_MAP[selectedProvider] || selectedProvider;
      try {
        const decryptedKey = await getProviderApiKey(prisma, userId, providerKey as any, user);
        if (!decryptedKey) {
          return Response.json(
            { errorCode: "API_KEY_NOT_SET", provider: selectedProvider.toUpperCase(), vaultEnabled: false },
            { status: 400 }
          );
        }
        apiKey = decryptedKey;
      } catch (error: any) {
        const isVaultError = error?.message?.includes('[Secret Vault]')
        if (isVaultError) {
          return Response.json(
            { errorCode: "API_KEY_NOT_SET", provider: selectedProvider.toUpperCase(), vaultEnabled: true },
            { status: 400 }
          );
        }
        console.warn("API key decryption failed:", error.message);
        return Response.json({ errorCode: "API_KEY_DECRYPT_FAILED" }, { status: 500 });
      }
    }

    const result = await engine.processMessage({
      userId,
      prompt: body.prompt,
      provider: selectedProvider,
      model: selectedModel,
      apiKey,
      azureConfig,
      context: body.context,
      agentId: body.agentId,
      workflowId: body.workflowId,
      existingWorkflow: body.existingWorkflow,
      nodeId: body.nodeId,
      sessionId: body.sessionId,
      isFollowUp: body.isFollowUp,
      providerStatus: body.providerStatus,
      dataSheetId: body.dataSheetId,
      mcpConnectionId: body.mcpConnectionId,
      templateSource: getTemplateSource(req),
    });

    return Response.json({ success: true, ...result });

  } catch (error: any) {
    console.error("Codex API error:", describeCaughtError(error));

    if (error.message?.includes("API key")) {
      return Response.json(
        { errorCode: "INVALID_API_KEY", provider: "OPENAI" },
        { status: 401 }
      );
    }

    if (error.message?.includes("rate limit")) {
      return Response.json(
        { errorCode: "RATE_LIMIT_EXCEEDED" },
        { status: 429 }
      );
    }

    if (error.message?.includes("parse") || error.message?.includes("incomplete")) {
      const errorCode = error.message.includes('incomplete')
        ? 'RESPONSE_TOO_LONG'
        : 'RESPONSE_PARSE_ERROR';

      return Response.json(
        { errorCode },
        { status: 500 }
      );
    }

    return Response.json(
      { errorCode: "GENERATION_FAILED" },
      { status: 500 }
    );
  }
}

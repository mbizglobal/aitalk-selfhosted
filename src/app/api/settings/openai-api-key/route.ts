import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt, maskApiKey } from '@/lib/encryption';
import { ensureUserDataKey } from '@/lib/user-data-key';
import { getErrorMessage, getLanguageFromHeaders, getTranslations } from '@/lib/translations/dashboard';
import { getApiKeyFromUser, hasApiKey } from '@/lib/ai-providers';
import OpenAI from 'openai';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session || !session.user?.id) {
      const language = getLanguageFromHeaders(new Headers());
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 });
    }

    const userId = session.user.id;

    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { aiProviders: true, zki: true }
    });

    if (!user) {
      const language = getLanguageFromHeaders(new Headers());
      return NextResponse.json({ error: getErrorMessage('api_error_user_not_found', language) }, { status: 404 });
    }

    let decryptedApiKey = "";
    let maskedApiKey = "";
    let selectedModel = "gpt-4o-mini";
    let temperature = 0.7;
    let maxTokens = 2048;
    let topP = 1.0;
    let effort = "medium";
    let verbosity = "medium";
    let summary = "auto";
    let storeLogs = true;
    let systemMessage = "";

    const hasOpenAIKey = hasApiKey(user, 'openai');

    if (hasOpenAIKey) {
      try {
        decryptedApiKey = await getApiKeyFromUser(user, 'openai') || '';
      } catch (error) {
      }
    }

    if (decryptedApiKey) {
      maskedApiKey = maskApiKey(decryptedApiKey);
    }

    const agent = agentId
      ? await prisma.agent.findFirst({
          where: { agentId, userId },
          select: { aiConfig: true }
        })
      : await prisma.agent.findFirst({
          where: { userId },
          select: { aiConfig: true },
          orderBy: { createdAt: 'asc' }
        })

    if (agent?.aiConfig) {
      try {
        const config = JSON.parse(agent.aiConfig)
        selectedModel = config.model || "gpt-4o-mini"
        temperature = config.temperature ?? 0.7
        maxTokens = config.maxTokens ?? 2048
        topP = config.topP ?? 1.0
        effort = config.effort || "medium"
        verbosity = config.verbosity || "medium"
        summary = config.summary || "auto"
        storeLogs = config.storeLogs !== undefined ? config.storeLogs : true
        systemMessage = config.systemMessage || ""
      } catch (e) {
      }
    }

    return NextResponse.json({
      hasApiKey: hasOpenAIKey,
      maskedApiKey,
      selectedModel,
      temperature,
      maxTokens,
      topP,
      effort,
      verbosity,
      summary,
      storeLogs,
      systemMessage: systemMessage || "",
    });
  } catch (error) {
    console.error('[GET /api/settings/openai-api-key] Error:', error);
    const language = getLanguageFromHeaders(new Headers());
    return NextResponse.json({ error: getErrorMessage('api_error_internal_server', language) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session || !session.user?.id) {
      const language = getLanguageFromHeaders(request.headers);
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { apiKey, model, temp, tokens, topP, effort, verbosity, summary, storeLogs, systemMessage, checkAgents = false, agentId } = body;


    // If only model/temp/tokens/systemMessage is being updated (empty API key)
    if (!apiKey || !apiKey.trim()) {
      if (model || temp !== undefined || tokens !== undefined || topP !== undefined || effort || verbosity || summary || storeLogs !== undefined || systemMessage !== undefined) {
        try {
          const updateAgentAiConfig = async (targetAgentId: string) => {
            const agent = await prisma.agent.findUnique({
              where: { agentId: targetAgentId },
              select: { aiConfig: true }
            })

            let currentConfig: any = {}
            if (agent?.aiConfig) {
              try {
                currentConfig = JSON.parse(agent.aiConfig)
              } catch (e) {
              }
            }

            if (model) currentConfig.model = model
            if (temp !== undefined) currentConfig.temperature = temp
            if (tokens !== undefined) currentConfig.maxTokens = tokens
            if (topP !== undefined) currentConfig.topP = topP
            if (effort) currentConfig.effort = effort
            if (verbosity) currentConfig.verbosity = verbosity
            if (summary) currentConfig.summary = summary
            if (storeLogs !== undefined) currentConfig.storeLogs = storeLogs
            if (systemMessage !== undefined) currentConfig.systemMessage = systemMessage

            await prisma.agent.update({
              where: { agentId: targetAgentId },
              data: { aiConfig: JSON.stringify(currentConfig) }
            })
          }

          if (agentId) {
            await updateAgentAiConfig(agentId)
          } else {
            const agent = await prisma.agent.findFirst({
              where: { userId: userId },
              orderBy: { createdAt: 'asc' }
            });

            if (agent) {
              await updateAgentAiConfig(agent.agentId)
            }
          }

          return NextResponse.json({
            success: true
          });
        } catch (error) {
          console.error('[POST /api/settings/openai-api-key] Update error:', error);
          const language = getLanguageFromHeaders(request.headers);
          return NextResponse.json({
            error: getErrorMessage('api_error_update_failed', language)
          }, { status: 500 });
        }
      }
      const language = getLanguageFromHeaders(request.headers);
      return NextResponse.json({ error: getErrorMessage('api_error_api_key_empty', language) }, { status: 400 });
    }

    const openai = new OpenAI({
      apiKey: apiKey,
    });

    try {
      await openai.models.list();
    } catch (error) {
      const language = getLanguageFromHeaders(request.headers);
      return NextResponse.json({ error: getErrorMessage('api_error_api_key_invalid', language) }, { status: 400 });
    }

    const createdVectorStores: any[] = [];

    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { id: userId },
        include: { aiProviders: true, zki: true }
      });

      if (!existingUser) {
        throw new Error('User not found');
      }

      const dataKey = await ensureUserDataKey(tx, userId);

      const encryptedApiKey = encrypt(apiKey, dataKey);

      const translations = getTranslations('en');

      let providersConfig: Record<string, any> = {};
      if (existingUser.aiProviders?.providers) {
        try {
          providersConfig = JSON.parse(existingUser.aiProviders.providers);
        } catch (e) {
        }
      }

      providersConfig.openai = {
        apiKey: encryptedApiKey.toString("base64"),
        updatedAt: new Date().toISOString()
      };

      await tx.aiProviders.upsert({
        where: { id: userId },
        update: {
          providers: JSON.stringify(providersConfig),
        },
        create: {
          id: userId,
          providers: JSON.stringify(providersConfig),
          defaultProvider: 'openai',
        },
      });

      const updateAgentAiConfigTx = async (targetAgentId: string) => {
        const agent = await tx.agent.findUnique({
          where: { agentId: targetAgentId },
          select: { aiConfig: true }
        })

        let currentConfig: any = {}
        if (agent?.aiConfig) {
          try {
            currentConfig = JSON.parse(agent.aiConfig)
          } catch (e) {
          }
        }

        if (model) currentConfig.model = model
        if (temp !== undefined) currentConfig.temperature = temp
        if (tokens !== undefined) currentConfig.maxTokens = tokens
        if (systemMessage !== undefined) {
          currentConfig.systemMessage = systemMessage
        } else if (!currentConfig.systemMessage) {
          currentConfig.systemMessage = translations.default_system_message
        }

        await tx.agent.update({
          where: { agentId: targetAgentId },
          data: { aiConfig: JSON.stringify(currentConfig) }
        })
      }

      if (agentId) {
        await updateAgentAiConfigTx(agentId)
      } else {
        const agents = await tx.agent.findMany({
          where: { userId: userId },
          select: { agentId: true }
        })

        for (const agent of agents) {
          await updateAgentAiConfigTx(agent.agentId)
        }
      }

      const existingSubscription = await tx.subscription.findUnique({
        where: { id: userId }
      });

      if (!existingSubscription) {
        const now = new Date();
        const originalDay = now.getDate();

        const getNextMonthDate = (baseDate: Date, originalDayOfMonth: number) => {
          const year = baseDate.getFullYear();
          const month = baseDate.getMonth();

          let nextMonth = month + 1;
          let nextYear = year;

          if (nextMonth > 11) {
            nextMonth = 0;
            nextYear++;
          }

          const lastDayOfNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();

          const nextDay = Math.min(originalDayOfMonth, lastDayOfNextMonth);

          return new Date(nextYear, nextMonth, nextDay,
                         baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds());
        };

        const oneMonthLater = getNextMonthDate(now, originalDay);

        await tx.subscription.create({
          data: {
            id: userId,
            month: 1,
            num_assistant: 1,
            free_cpa: 50,
            free_total: 50,
            paid_cpa: 0,
            paid_total: 0,
            start_date: now,
            end_date: oneMonthLater,
            created_at: now,
          }
        });

      }
    });

    if (checkAgents) {
      try {
        const agents = await prisma.agent.findMany({
          where: { userId: userId }
        });


        const existingVectorStores = await prisma.agent.count({
          where: {
            userId: userId,
            vectorStoreId: { not: null }
          }
        });

        let vectorStoreCounter = existingVectorStores + 1;

        for (const agent of agents) {
          if (!agent.vectorStoreId || !agent.vectorStoreName) {
            try {

              const vectorStoreName = `AITalk_${String(vectorStoreCounter).padStart(2, '0')}_${agent.agentId}`;

              let vectorStore;
              try {
                vectorStore = await openai.vectorStores.create({
                  name: vectorStoreName
                });
              } catch (apiError) {
                try {
                  const response = await fetch('https://api.openai.com/v1/vector_stores', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${apiKey}`,
                      'Content-Type': 'application/json',
                      'OpenAI-Beta': 'assistants=v2'
                    },
                    body: JSON.stringify({
                      name: vectorStoreName
                    })
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                  }

                  vectorStore = await response.json();
                } catch (directError) {
                  throw new Error(`Failed to create Vector Store with all methods`);
                }
              }


              await prisma.agent.update({
                where: { agentId: agent.agentId },
                data: {
                  vectorStoreId: vectorStore.id,
                  vectorStoreName: vectorStore.name,
                  updatedAt: new Date()
                }
              });

              createdVectorStores.push({
                agentId: agent.agentId,
                vectorStoreId: vectorStore.id,
                vectorStoreName: vectorStore.name
              });


              vectorStoreCounter++;
            } catch (error) {
            }
          }
        }
      } catch (error) {
      }
    }

    const language = getLanguageFromHeaders(request.headers);
    return NextResponse.json({
      success: true,
      message: getErrorMessage('openai_api_key_saved', language),
      createdVectorStores: createdVectorStores.length > 0 ? createdVectorStores : undefined
    });

  } catch (error) {
    const language = getLanguageFromHeaders(request.headers);
    return NextResponse.json({
      error: getErrorMessage('api_error_save_failed', language)
    }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session || !session.user?.id) {
      const language = getLanguageFromHeaders(new Headers());
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 });
    }

    const userId = session.user.id;

    await prisma.$transaction(async (tx) => {
      const aiProviders = await tx.aiProviders.findUnique({
        where: { id: userId }
      });

      if (aiProviders?.providers) {
        try {
          const providersConfig = JSON.parse(aiProviders.providers);
          delete providersConfig.openai;

          await tx.aiProviders.update({
            where: { id: userId },
            data: {
              providers: JSON.stringify(providersConfig),
              defaultProvider: aiProviders.defaultProvider === 'openai' ? 'openai' : aiProviders.defaultProvider
            }
          });
        } catch (e) {
          await tx.aiProviders.update({
            where: { id: userId },
            data: {
              providers: '{}',
            }
          });
        }
      }
    });

    return NextResponse.json({
      success: true
    });

  } catch (error) {
    const language = getLanguageFromHeaders(new Headers());
    return NextResponse.json({
      error: getErrorMessage('api_error_delete_failed', language)
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'dashboard_api_unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const agentIdParam = searchParams.get('agentId');

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        encryptedDataKey: true,
        zkiId: true,
        zki: { select: { masterKey: true } }
      }
    });

    if (!user?.encryptedDataKey) {
      return NextResponse.json({
        success: true,
        conversations: []
      });
    }

    let dataKey: Buffer;
    if (user.zkiId && user.zki?.masterKey) {
      dataKey = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey);
    } else {
      dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey));
    }

    let agentIds: string[];

    if (agentIdParam) {
      const agent = await prisma.agent.findFirst({
        where: {
          agentId: agentIdParam,
          userId: session.user.id
        },
        select: { agentId: true }
      });

      if (!agent) {
        return NextResponse.json({
          success: true,
          conversations: []
        });
      }

      agentIds = [agent.agentId];
    } else {
      const userAgents = await prisma.agent.findMany({
        where: { userId: session.user.id },
        select: { agentId: true }
      });

      if (userAgents.length === 0) {
        return NextResponse.json({
          success: true,
          conversations: []
        });
      }

      agentIds = userAgents.map(agent => agent.agentId);
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        agentId: {
          in: agentIds
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 20,
      select: {
        no: true,
        conversation_id: true,
        client_id: true,
        role: true,
        content: true,
        created_at: true,
        agentId: true,
        user_ip: true
      }
    });


    const conversationMap = new Map();

    conversations.forEach(conv => {
      const convId = conv.conversation_id;
      if (!conversationMap.has(convId)) {
        let messagePreview = 'recent_conversations_no_message';

        try {
          if (conv.content) {
            let messageData;
            const contentBuffer = Buffer.from(conv.content);

            try {
              messageData = JSON.parse(contentBuffer.toString('utf8'));
            } catch {
              const decryptedContent = decrypt(contentBuffer, dataKey);
              if (decryptedContent === 'Decryption failed') {
                messagePreview = 'recent_conversations_encrypted_message';
                return;
              }
              messageData = JSON.parse(decryptedContent);
            }

            if (messageData.messages && Array.isArray(messageData.messages)) {
              const firstUserMessage = messageData.messages.find((msg: any) => msg.role === 'user');
              if (firstUserMessage && firstUserMessage.content) {
                const content = firstUserMessage.content;
                messagePreview = content.length > 50 ? content.substring(0, 50) + '...' : content;
              }
            }
          }
        } catch {
          messagePreview = 'recent_conversations_encrypted_message';
        }

        conversationMap.set(convId, {
          id: conv.no,
          conversation_id: convId,
          user: conv.client_id ? `recent_conversations_user_with_id${conv.client_id.slice(-4)}` : 'recent_conversations_anonymous_user',
          message: messagePreview,
          time: getRelativeTime(conv.created_at),
          status: 'resolved',
          title: `recent_conversations_conversation_title ${convId.slice(-8)}`,
          userIP: conv.user_ip
        });
      }
    });

    const formattedConversations = Array.from(conversationMap.values()).slice(0, 4);

    return NextResponse.json({
      success: true,
      conversations: formattedConversations
    });

  } catch (error) {
    return NextResponse.json({
      error: 'dashboard_api_internal_server_error',
      details: error instanceof Error ? error.message : 'dashboard_api_unknown_error'
    }, { status: 500 });
  }
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 60) {
    return `${minutes} recent_conversations_time_min_ago`;
  } else if (hours < 24) {
    return hours > 1 ? `${hours} recent_conversations_time_hours_ago` : `${hours} recent_conversations_time_hour_ago`;
  } else {
    return days > 1 ? `${days} recent_conversations_time_days_ago` : `${days} recent_conversations_time_day_ago`;
  }
}

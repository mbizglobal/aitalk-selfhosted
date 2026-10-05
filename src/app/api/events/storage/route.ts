import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { googleDriveQueue } from '@/lib/googleDriveQueue'
import { storageSSE } from '@/lib/storageSSE'
import { getApiTranslation } from '@/lib/translations'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const t = getApiTranslation(request)
  const session = await getServerSession(authOptions as any) as any

  if (!session?.user?.id) {
    return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const agentId = searchParams.get('agentId')

  if (!agentId) {
    return NextResponse.json({ error: t('api_error_agent_id_required') }, { status: 400 })
  }

  const agent = await prisma.agent.findUnique({
    where: { agentId },
    select: { userId: true },
  })

  if (!agent || agent.userId !== session.user.id) {
    return NextResponse.json({ error: t('api_error_agent_not_found_or_unauthorized') }, { status: 404 })
  }

  const encoder = new TextEncoder()
  
  const customReadable = new ReadableStream({
    start(controller) {

      const headers = [
        'data: {"type": "connected", "message": "SSE connection established"}',
        '',
      ].join('\n')
      
      controller.enqueue(encoder.encode(headers))

      const sseCallback = (update: any) => {
        if (update.agentId === agentId) {
          try {
            const sseData = [
              `data: ${JSON.stringify(update)}`,
              '',
            ].join('\n')

            controller.enqueue(encoder.encode(sseData))
          } catch (error) {
            console.error('[SSE] Failed to send update:', error)
          }
        }
      }

      storageSSE.addSSEClient(sseCallback)
      googleDriveQueue.addSSEClient(sseCallback)

      request.signal.addEventListener('abort', () => {
        storageSSE.removeSSEClient(sseCallback)
        googleDriveQueue.removeSSEClient(sseCallback)
      })

      const keepAlive = setInterval(() => {
        try {
          const keepAliveData = [
            'data: {"type": "ping", "timestamp": ' + Date.now() + '}',
            '',
          ].join('\n')
          
          controller.enqueue(encoder.encode(keepAliveData))
        } catch (error) {
          console.error('[SSE] Keep-alive failed:', error)
          clearInterval(keepAlive)
        }
      }, 30000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        storageSSE.removeSSEClient(sseCallback)
        googleDriveQueue.removeSSEClient(sseCallback)
      })
    },
    cancel() {
    }
  })

  return new Response(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  })
}
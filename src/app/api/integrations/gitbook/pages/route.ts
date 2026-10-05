
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { GitBookClient } from '@/lib/integrations/gitbook'
import {
  decrypt,
  decryptDataKey,
  decryptDataKeyWithLegacy,
} from '@/lib/encryption'

interface ImportedPage {
  path: string
  title: string
  importedAt: string
  noData?: boolean
}

export interface GitBookPageItem {
  id: string
  path: string
  title: string
  kind: string
  imported: boolean
  importedAt?: string
  noData?: boolean
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'agentId is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id,
      },
      select: {
        gitbookAccessToken: true,
        gitbookSpaceId: true,
        gitbookPublishedUrl: true,
        gitbookImportedPages: true,
      },
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      )
    }

    if (!agent.gitbookSpaceId) {
      return NextResponse.json(
        { success: false, error: 'GitBook Space ID가 설정되지 않았습니다.' },
        { status: 400 }
      )
    }

    let accessToken: string | null = null

    if (agent.gitbookAccessToken) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          encryptedDataKey: true,
          zkiId: true,
          zki: { select: { masterKey: true } },
        },
      })

      if (!user?.encryptedDataKey) {
        return NextResponse.json(
          { success: false, error: 'Encryption key not found' },
          { status: 500 }
        )
      }

      let dataKey: Buffer
      if (user.zkiId && user.zki?.masterKey) {
        dataKey = decryptDataKeyWithLegacy(
          Buffer.from(user.encryptedDataKey),
          user.zki.masterKey
        )
      } else {
        dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey))
      }

      accessToken = decrypt(
        Buffer.from(agent.gitbookAccessToken, 'base64'),
        dataKey
      )
    }

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'GitBook Access Token이 설정되지 않았습니다.' },
        { status: 400 }
      )
    }

    const client = new GitBookClient({ accessToken })

    const isConnected = await client.validateConnectionWithSpace(agent.gitbookSpaceId)
    if (!isConnected) {
      return NextResponse.json(
        { success: false, error: 'GitBook 연결 실패. Access Token을 확인해주세요.' },
        { status: 400 }
      )
    }

    const gitbookPages = await client.getAllPagesFlat(agent.gitbookSpaceId)

    let importedPages: ImportedPage[] = []
    if (agent.gitbookImportedPages) {
      try {
        importedPages = JSON.parse(agent.gitbookImportedPages)
      } catch (e) {
        console.error('Failed to parse gitbookImportedPages:', describeCaughtError(e))
      }
    }

    const importedPathMap = new Map<string, ImportedPage>()
    for (const page of importedPages) {
      importedPathMap.set(page.path, page)
    }

    const pages: GitBookPageItem[] = gitbookPages
      .filter((page) => {
        const kind = (page.kind || page.type || '').toLowerCase()
        return kind !== 'group' && kind !== 'link'
      })
      .map((page) => {
        const importedPage = importedPathMap.get(page.path)
        return {
          id: page.id,
          path: page.path,
          title: page.title,
          kind: page.kind || page.type || 'document',
          imported: !!importedPage,
          importedAt: importedPage?.importedAt,
          noData: importedPage?.noData,
        }
      })

    return NextResponse.json({
      success: true,
      spaceId: agent.gitbookSpaceId,
      pages,
      total: pages.length,
      importedCount: importedPages.length,
    })
  } catch (error: any) {
    console.error('GitBook pages list error:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

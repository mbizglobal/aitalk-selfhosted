
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import DataSheetDetailClient from './client'

interface PageProps {
  params: Promise<{
    agentId: string
    sheetId: string
  }>
}

export default async function DataSheetDetailPage({ params }: PageProps) {
  const { agentId, sheetId } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/auth')
  }

  const agent = await prisma.agent.findFirst({
    where: {
      agentId,
      userId: session.user.id
    },
    select: {
      id: true,
      agentId: true,
      title: true,
      userId: true,
    }
  })

  if (!agent) {
    redirect('/app')
  }

  const sheet = await prisma.dataSheet.findUnique({
    where: { id: sheetId },
    select: {
      id: true,
      agentId: true,
      name: true,
      description: true,
      schema: true,
      sizeBytes: true,
      rowCount: true,
      createdAt: true,
      updatedAt: true,
    }
  })

  if (!sheet || sheet.agentId !== agentId) {
    redirect(`/app/agents/${agentId}/data-sheets`)
  }

  const rows = await prisma.dataSheetRow.findMany({
    where: { sheetId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      rowData: true,
      createdAt: true,
      updatedAt: true,
    }
  })

  return (
    <DataSheetDetailClient
      agent={agent}
      sheet={{ ...sheet, agentId }}
      initialRows={rows}
    />
  )
}

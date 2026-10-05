/**
 * Data Sheets List Page
 * /app/agents/[agentId]/data-sheets
 */

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import DataSheetsListClient from './client'

interface PageProps {
  params: Promise<{
    agentId: string
  }>
}

export default async function DataSheetsListPage({ params }: PageProps) {
  const { agentId } = await params

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

  const dataSheets = await prisma.dataSheet.findMany({
    where: { agentId },
    orderBy: { updatedAt: 'desc' },
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

  return (
    <DataSheetsListClient
      agent={agent}
      initialDataSheets={dataSheets.map((s) => ({ ...s, agentId }))}
    />
  )
}

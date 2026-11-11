import { prisma } from '@/lib/prisma'

export async function isPasswordTeamMember(email: string): Promise<boolean> {
  const row = await prisma.agentMember.findFirst({
    where: { email: email.trim().toLowerCase(), status: 'active', authMethod: 'password', agent: { accessMode: 'team' } },
    select: { id: true },
  })
  return !!row
}

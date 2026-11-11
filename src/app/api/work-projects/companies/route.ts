
import { prisma } from '@/lib/prisma'
import { workOwnerRoute } from '@/lib/work/http'
import { companyLimitOf, countCompanyBooks } from '@/lib/work/company-limit'

export const GET = workOwnerRoute('owner.companies', async (_req, { userId }) => {
  const [used, limit] = await Promise.all([prisma.$transaction((tx) => countCompanyBooks(tx, userId)), companyLimitOf(prisma, userId)])
  return { used, limit }
})

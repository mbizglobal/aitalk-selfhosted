const g = globalThis as unknown as { prisma?: unknown }
g.prisma = { agent: { findUnique: async () => null } }


import { workRoute } from '@/lib/work/http'
import { readPeerSettings } from '@/lib/work/peer-settings'

export const GET = workRoute<{ agentId: string; projectId: string }>('peer-settings.read', async (_req, { access, deps }, p) => ({
  peers: await readPeerSettings(deps, access, p.projectId),
}))

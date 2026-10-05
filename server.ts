
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from './src/lib/prisma'
import { attachVoiceUpgrade } from './src/lib/call/server-voice'
import { describeCaughtError } from './src/lib/log-mask'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port, turbopack: dev })
const handle = app.getRequestHandler()

//

app.prepare().then(async () => {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000)
    const r = await prisma.webVoiceSession.updateMany({
      where: { endedAt: null, startedAt: { lt: cutoff } },
      data: { endedAt: new Date(), durationSeconds: 0 },
    })
    if (r.count > 0) {
      console.log(`[startup] Closed ${r.count} stale web_voice_session(s) (>15min)`)
    }
  } catch (e) {
    console.error('[startup] web_voice_session cleanup failed:', describeCaughtError(e))
  }

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || '', true)
    handle(req, res, parsedUrl)
  })

  attachVoiceUpgrade(server)

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})

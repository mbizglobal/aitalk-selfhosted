import type { Server } from 'http'
import { parse } from 'url'

export function attachVoiceUpgrade(server: Server): void {
  server.on('upgrade', (req, socket) => {
    const { pathname } = parse(req.url || '', true)
    if ((pathname ?? '').startsWith('/_next/')) return
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
  })
}

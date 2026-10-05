import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FileStore } from './index'
import { segmentsOf } from './keys'

export function createDiskFileStore(rootDir: string): FileStore {
  if (!path.isAbsolute(rootDir)) throw new Error('[FileStore] FILE_STORE_DIR must be an absolute path')
  const root = path.resolve(rootDir)

  const resolve = (key: string, what: 'key' | 'prefix') => {
    const full = path.resolve(root, ...segmentsOf(key, what))
    if (!full.startsWith(root + path.sep)) throw new Error(`[FileStore] ${what} escapes the store`)
    return full
  }

  let realRoot: string | null = null
  const assertInside = async (full: string) => {
    await fs.mkdir(root, { recursive: true })
    realRoot ??= await fs.realpath(root)
    let dir = path.dirname(full)
    for (;;) {
      try {
        const real = await fs.realpath(dir)
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('[FileStore] path escapes the store through a link')
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        dir = path.dirname(dir)
      }
    }
    const st = await fs.lstat(full).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e })
    if (st?.isSymbolicLink()) throw new Error('[FileStore] refusing a symbolic link in the store')
  }

  return {
    async put(key, data) {
      const full = resolve(key, 'key')
      await assertInside(full)
      await fs.mkdir(path.dirname(full), { recursive: true })
      const tmp = `${full}.${crypto.randomBytes(6).toString('hex')}.tmp`
      try {
        await fs.writeFile(tmp, data, { flag: 'wx' })
        await fs.rename(tmp, full)
      } catch (e) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
    },
    async get(key) {
      const full = resolve(key, 'key')
      await assertInside(full)
      return fs.readFile(full)
    },
    async delete(key) {
      const full = resolve(key, 'key')
      await assertInside(full)
      await fs.rm(full, { force: true })
    },
    async deletePrefix(prefix) {
      const dir = resolve(prefix, 'prefix')
      await assertInside(dir)
      let count = 0
      const walk = async (d: string): Promise<void> => {
        let entries
        try { entries = await fs.readdir(d, { withFileTypes: true }) } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
          throw e
        }
        for (const e of entries) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) await walk(p)
          else count++
        }
      }
      await walk(dir)
      await fs.rm(dir, { recursive: true, force: true })
      return count
    },
  }
}


import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

import {
  discardCachedConnection,
  connectAndLock,
  relockCachedConnection,
  refreshCachedLock,
  closeCachedConnection,
  closeConnection,
  __imapConnectionCacheForTest as cache,
} from './imap'

function fakeConnection(opts: { closeThrows?: boolean; lockThrows?: boolean } = {}) {
  const seen = { close: 0, logout: 0, release: 0 }
  return {
    seen,
    entry: {
      client: {
        close() { seen.close++; if (opts.closeThrows) throw new Error('socket already destroyed') },
        async logout() { seen.logout++ },
        usable: true,
      } as any,
      lastUsed: Date.now(),
      lock: { release() { seen.release++; if (opts.lockThrows) throw new Error('lock gone') } } as any,
      folder: 'INBOX',
    },
  }
}

describe('discardCachedConnection: connection cleanup on the error path', () => {
  beforeEach(() => cache.clear())

  it('🔴 actually closes the socket (only removing it from the cache would never close it)', () => {
    const { seen, entry } = fakeConnection()
    cache.set('k', entry)

    discardCachedConnection('k', entry.client)

    assert.equal(seen.close, 1, 'client.close() 가 안 불렸다 — 소켓이 열린 채 참조를 잃는다')
    assert.equal(cache.has('k'), false, '캐시에서도 지워야 한다')
  })

  it('also releases the mailbox lock', () => {
    const { seen, entry } = fakeConnection()
    cache.set('k', entry)

    discardCachedConnection('k', entry.client)

    assert.equal(seen.release, 1)
  })

  it('🔴 does not use graceful `logout()`; waiting for a LOGOUT response on a broken connection hangs', () => {
    const { seen, entry } = fakeConnection()
    cache.set('k', entry)

    discardCachedConnection('k', entry.client)

    assert.equal(seen.logout, 0, 'logout() 은 서버 왕복이라 오류 경로에 쓰면 안 된다')
  })

  it('cache cleanup finishes even if close() throws (must not throw again on top of the error path)', () => {
    const { seen, entry } = fakeConnection({ closeThrows: true })
    cache.set('k', entry)

    assert.doesNotThrow(() => discardCachedConnection('k', entry.client))
    assert.equal(seen.close, 1)
    assert.equal(cache.has('k'), false)
  })

  it('closes the socket even if lock.release() throws (an earlier-step failure must not skip later steps)', () => {
    const { seen, entry } = fakeConnection({ lockThrows: true })
    cache.set('k', entry)

    assert.doesNotThrow(() => discardCachedConnection('k', entry.client))
    assert.equal(seen.close, 1, 'lock 해제 실패가 close() 를 삼켰다')
  })

  it('does not throw even for a key not in the cache (when connection creation itself failed)', () => {
    assert.doesNotThrow(() => discardCachedConnection('없는키', undefined))
  })

  it('🔴 when there is no owned connection (undefined), does not touch the cache; it may be someone else\'s', () => {
    const winner = fakeConnection()
    cache.set('k', winner.entry)

    discardCachedConnection('k', undefined)

    assert.equal(winner.seen.close, 0, '남의 연결을 닫았다')
    assert.equal(winner.seen.release, 0, '남의 lock 을 해제했다')
    assert.equal(cache.get('k'), winner.entry, '남의 캐시 엔트리를 지웠다')
  })

  it('closes the socket even if lock is null', () => {
    const { seen, entry } = fakeConnection()
    cache.set('k', { ...entry, lock: null })

    discardCachedConnection('k', entry.client)

    assert.equal(seen.close, 1)
  })

  it('does not touch connections under other keys', () => {
    const a = fakeConnection()
    const b = fakeConnection()
    cache.set('a', a.entry)
    cache.set('b', b.entry)

    discardCachedConnection('a', a.entry.client)

    assert.equal(b.seen.close, 0, '남의 연결을 닫았다')
    assert.equal(cache.has('b'), true)
  })

  it('🔴 if the cache winner is someone else\'s connection, does not close it (closes only its own)', () => {
    const mine = fakeConnection()
    const winner = fakeConnection()
    cache.set('k', winner.entry)

    discardCachedConnection('k', mine.entry.client)

    assert.equal(winner.seen.close, 0, '진행 중인 남의 연결을 끊었다')
    assert.equal(winner.seen.release, 0, '남의 lock 을 해제했다')
    assert.equal(cache.get('k'), winner.entry, '남의 캐시 엔트리를 지웠다')
    assert.equal(mine.seen.close, 1, '정작 내 소켓을 안 닫았다 — 캐시에 없으니 아무도 못 닫는다')
  })

  it('if the cache winner is its own connection, removes it from the cache and closes as usual (control)', () => {
    const mine = fakeConnection()
    cache.set('k', mine.entry)

    discardCachedConnection('k', mine.entry.client)

    assert.equal(mine.seen.close, 1)
    assert.equal(cache.has('k'), false)
  })

  it('closes its own connection even if it is not in the cache at all (when displaced before registration)', () => {
    const mine = fakeConnection()
    discardCachedConnection('k', mine.entry.client)
    assert.equal(mine.seen.close, 1)
  })
})

describe('connectAndLock: failure before it is put in the cache', () => {
  const fakeClient = (fail: 'connect' | 'lock' | null) => {
    const seen = { connect: 0, lock: 0, close: 0 }
    return {
      seen,
      client: {
        async connect() { seen.connect++; if (fail === 'connect') throw new Error('connect refused') },
        async getMailboxLock(_f: string) { seen.lock++; if (fail === 'lock') throw new Error('lock denied'); return { release() {} } },
        close() { seen.close++ },
      } as any,
    }
  }

  it('🔴 if lock acquisition fails, closes the connected socket (if not closed here, nobody can)', async () => {
    const { seen, client } = fakeClient('lock')
    await assert.rejects(() => connectAndLock(client, 'INBOX'), /lock denied/)
    assert.equal(seen.connect, 1)
    assert.equal(seen.close, 1, 'getMailboxLock 실패 후 close() 가 안 불렸다 — 소켓이 샌다')
  })

  it('also closes if connect itself fails (the socket may be open during the handshake)', async () => {
    const { seen, client } = fakeClient('connect')
    await assert.rejects(() => connectAndLock(client, 'INBOX'), /connect refused/)
    assert.equal(seen.close, 1)
  })

  it('re-propagates the failure; swallowing it makes the caller cache a nonexistent connection', async () => {
    const { client } = fakeClient('lock')
    await assert.rejects(() => connectAndLock(client, 'INBOX'))
  })

  it('control: does not close on the success path (closing would make the cache hold a dead connection)', async () => {
    const { seen, client } = fakeClient(null)
    const lock = await connectAndLock(client, 'INBOX')
    assert.ok(lock, 'lock 을 돌려줘야 한다')
    assert.equal(seen.close, 0, '성공했는데 소켓을 닫았다')
  })
})

describe('relockCachedConnection: folder switch failure', () => {
  beforeEach(() => cache.clear())

  const entry = (lockFails: boolean) => {
    const seen = { release: 0, lock: 0, close: 0 }
    const e = {
      client: {
        async getMailboxLock(_f: string) {
          seen.lock++
          if (lockFails) throw new Error('mailbox busy')
          return { release() { seen.release++ } }
        },
        close() { seen.close++ },
        usable: true,
      } as any,
      lastUsed: Date.now(),
      lock: { release() { seen.release++ } } as any,
      folder: 'INBOX',
    }
    return { seen, e }
  }

  it('🔴 on failure, removes it from the cache and closes the socket (leaves no entry holding a dead lock)', async () => {
    const { seen, e } = entry(true)
    cache.set('k', e)

    await assert.rejects(() => relockCachedConnection('k', e, 'Spam'), /mailbox busy/)

    assert.equal(cache.has('k'), false, '해제된 lock 을 쥔 엔트리가 캐시에 남았다')
    assert.equal(seen.close, 1, '소켓을 안 닫았다')
  })

  it('🔴 on failure, clears the entry\'s lock and folder (the reuse check must not see the old folder)', async () => {
    const { e } = entry(true)
    cache.set('k', e)

    await assert.rejects(() => relockCachedConnection('k', e, 'Spam'))

    assert.equal(e.lock, null, 'lock 이 해제된 객체를 계속 가리킨다')
    assert.equal(e.folder, null, 'folder 가 옛 값이면 다음 호출이 재획득을 건너뛴다')
  })

  it('re-propagates the failure; swallowing it makes the caller proceed without a lock', async () => {
    const { e } = entry(true)
    await assert.rejects(() => relockCachedConnection('k', e, 'Spam'))
  })

  it('if another run overwrote the cache in the meantime, does not delete that one', async () => {
    const mine = entry(true)
    const winner = entry(false)
    cache.set('k', winner.e)

    await assert.rejects(() => relockCachedConnection('k', mine.e, 'Spam'))

    assert.equal(cache.get('k'), winner.e, '남의 엔트리를 지웠다')
    assert.equal(winner.seen.close, 0, '남의 연결을 닫았다')
    assert.equal(mine.seen.close, 1, '정작 내 연결을 안 닫았다')
  })

  it('🔴 the best-effort version (refreshCachedLock) does not close the connection on failure; the in-progress loop uses it', async () => {
    const { seen, e } = entry(true)
    cache.set('k', e)

    const r = await refreshCachedLock(e, 'Spam')

    assert.equal(r.ok, false)
    assert.equal(seen.close, 0, '진행 중인 연결을 닫았다 — 남은 루프가 통째로 깨진다')
    assert.equal(cache.has('k'), true, '진행 중인 엔트리를 캐시에서 뺐다')
  })

  it('🔴 the best-effort version also leaves no stale state (that is the core of this defect)', async () => {
    const { e } = entry(true)
    cache.set('k', e)

    await refreshCachedLock(e, 'Spam')

    assert.equal(e.lock, null, '해제된 lock 을 계속 가리킨다 — 다음 요청이 그걸 받는다')
    assert.equal(e.folder, null, 'folder 가 옛 값이면 재획득을 건너뛴다')
  })

  it('the best-effort version does not throw and returns the original error (diagnosis must not vanish)', async () => {
    const { e } = entry(true)
    const r = await refreshCachedLock(e, 'Spam')
    assert.equal(r.ok, false)
    assert.match(String((r as any).error?.message), /mailbox busy/)
  })

  it('control: on success, updates lock and folder and keeps it in the cache', async () => {
    const { seen, e } = entry(false)
    cache.set('k', e)

    await relockCachedConnection('k', e, 'Spam')

    assert.equal(e.folder, 'Spam')
    assert.ok(e.lock, 'lock 을 안 채웠다')
    assert.equal(seen.close, 0, '성공했는데 소켓을 닫았다')
    assert.equal(cache.has('k'), true)
    assert.equal(seen.release, 1, '옛 lock 을 해제하지 않았다')
  })
})

describe('the call sites actually use the helper (syntax contract)', () => {
  const SOURCE = 'src/lib/workflow/nodes/imap.ts'

  const parse = (path = SOURCE, text?: string) =>
    ts.createSourceFile(path, text ?? readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)

  function bodyOf(sf: ts.SourceFile, name: string): ts.Node {
    let found: ts.Node | undefined
    const walk = (node: ts.Node) => {
      if (found) return
      const isFn =
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name?.getText() === name
      if (isFn && (node as any).body) { found = (node as any).body; return }
      ts.forEachChild(node, walk)
    }
    walk(sf)
    assert.ok(found, `함수를 못 찾았다: ${name} — 이름이 바뀌었으면 이 검사도 함께 고친다`)
    return found!
  }

  function callsIn(scope: ts.Node): string[] {
    const out: string[] = []
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const e = node.expression
        out.push(ts.isPropertyAccessExpression(e) ? `${e.expression.getText()}.${e.name.getText()}` : e.getText())
      }
      ts.forEachChild(node, walk)
    }
    walk(scope)
    return out
  }

  function directCatchCalls(scope: ts.Node): string[] {
    const out: string[] = []
    const walk = (node: ts.Node) => {
      if (ts.isCatchClause(node)) {
        for (const stmt of node.block.statements) {
          let expr: ts.Expression | undefined
          if (ts.isExpressionStatement(stmt)) expr = stmt.expression
          if (expr && ts.isAwaitExpression(expr)) expr = expr.expression
          if (expr && ts.isCallExpression(expr)) {
            out.push(`${expr.expression.getText()}(${expr.arguments.map(a => a.getText()).join(', ')})`)
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(scope)
    return out
  }

  for (const method of ['executeMove', 'executeMarkRead']) {
    it(`🔴 the catch of ${method} calls discardCachedConnection(cacheKey, client) unconditionally`, () => {
      const calls = directCatchCalls(bodyOf(parse(), method))
      assert.ok(
        calls.includes('discardCachedConnection(cacheKey, client)'),
        `${method} catch 가 헬퍼를 안 부르거나 다른 키를 넘긴다. 실제: ${calls.join(' / ')}`,
      )
    })
  }

  for (const method of ['executeRead', 'executeCopy', 'executeDelete', 'executeBatchMove', 'executeListFolders']) {
    it(`🔴 the catch of ${method} (an action that does not use the cache) calls closeConnection(client)`, () => {
      const calls = directCatchCalls(bodyOf(parse(), method))
      assert.ok(
        calls.includes('closeConnection(client)'),
        `${method} catch 가 logout 만 시도한다 — 실패하면 소켓이 샌다. 실제: ${calls.join(' / ')}`,
      )
    })
  }

  it('🔴 getOrCreateConnection takes the new connection\'s lock only via connectAndLock', () => {
    const calls = callsIn(bodyOf(parse(), 'getOrCreateConnection'))
    assert.ok(calls.includes('connectAndLock'), 'connectAndLock 을 안 쓴다')
    assert.ok(!calls.includes('client.connect'), '새 client 를 직접 connect 한다 — 실패 시 닫을 주체가 없다')
    assert.ok(!calls.includes('client.getMailboxLock'), '새 client 의 lock 을 직접 잡는다')
    assert.ok(calls.includes('relockCachedConnection'), '폴더 전환을 헬퍼 없이 한다')
    assert.ok(!calls.includes('cached.client.getMailboxLock'), '캐시 연결의 lock 을 직접 잡는다')
  })

  it('🔴 executeMove does not relock directly (the UID sync spot)', () => {
    const calls = callsIn(bodyOf(parse(), 'executeMove'))
    assert.ok(calls.includes('refreshCachedLock'), '헬퍼를 안 쓴다 — 실패 시 stale 상태가 남는다')
    assert.ok(!calls.includes('client.getMailboxLock'), 'lock 을 직접 잡는다')
    assert.ok(!calls.includes('cached.lock.release'), 'lock 을 직접 해제한다')
  })

  it('🔴 both normal exit paths go through closeCachedConnection (timer, replacement)', () => {
    const sf = parse()
    assert.ok(callsIn(bodyOf(sf, 'startCleanupTimer')).includes('closeCachedConnection'), '유휴 정리 타이머')
    assert.ok(callsIn(bodyOf(sf, 'getOrCreateConnection')).includes('closeCachedConnection'), '연결 교체')
  })

  it('control: the checker actually catches (positive and negative fixtures)', () => {
    const bad = parse('a.ts', `function f(){ try { a() } catch (e) { connectionCache.delete(cacheKey); throw e } }`)
    assert.ok(!directCatchCalls(bodyOf(bad, 'f')).includes('discardCachedConnection(cacheKey, client)'), '옛 형태를 통과시킨다')

    const good = parse('b.ts', `function f(){ try { a() } catch (e) { discardCachedConnection(cacheKey, client); throw e } }`)
    assert.ok(directCatchCalls(bodyOf(good, 'f')).includes('discardCachedConnection(cacheKey, client)'), '올바른 형태를 거부한다')
  })

  it('control: a conditional call and a different key do not satisfy the contract', () => {
    const conditional = parse('c.ts', `function f(){ try { a() } catch (e) { if (x) discardCachedConnection(cacheKey, client) } }`)
    assert.ok(
      !directCatchCalls(bodyOf(conditional, 'f')).includes('discardCachedConnection(cacheKey, client)'),
      '`if` 로 감싼 호출을 «무조건 실행»으로 인정한다',
    )

    const wrongKey = parse('d.ts', `function f(){ try { a() } catch (e) { discardCachedConnection(otherKey, client) } }`)
    assert.ok(
      !directCatchCalls(bodyOf(wrongKey, 'f')).includes('discardCachedConnection(cacheKey, client)'),
      '다른 키를 넘기는 호출을 통과시킨다',
    )
  })

  it('🅿️ known limitation: alias refactoring falsely fails (pinned: this test fails once it is improved)', () => {
    const aliased = parse('e.ts', `function f(){ try { a() } catch (e) { const c = client; closeConnection(c) } }`)
    assert.ok(
      !directCatchCalls(bodyOf(aliased, 'f')).includes('closeConnection(client)'),
      '별칭을 따라가기 시작했다 — 위 「알려진 한계」 주석을 갱신할 것',
    )
  })
})

describe('closeConnection: an action that does not use the cache also cannot miss the socket', () => {
  const fake = (logoutThrows: boolean) => {
    const seen = { logout: 0, close: 0 }
    return {
      seen,
      client: {
        async logout() { seen.logout++; if (logoutThrows) throw new Error('connection gone') },
        close() { seen.close++ },
      } as any,
    }
  }

  it('🔴 closes the socket even if `logout()` throws (a broken connection arrives on the error path)', async () => {
    const { seen, client } = fake(true)
    await closeConnection(client)
    assert.equal(seen.close, 1, '종전 `try { logout } catch {}` 는 여기서 소켓을 놓쳤다')
  })

  it('control: when healthy, tries graceful `logout()` first', async () => {
    const { seen, client } = fake(false)
    await closeConnection(client)
    assert.equal(seen.logout, 1)
    assert.equal(seen.close, 1)
  })

  it('does not throw; a cleanup failure must not cover the original error', async () => {
    const client = { async logout() { throw new Error('x') }, close() { throw new Error('y') } } as any
    await assert.doesNotReject(() => closeConnection(client))
  })
})

describe('closeCachedConnection: the normal path also cannot miss the socket', () => {
  const entryWith = (opts: { logoutThrows?: boolean; lockThrows?: boolean }) => {
    const seen = { logout: 0, close: 0, release: 0 }
    return {
      seen,
      cached: {
        client: {
          async logout() { seen.logout++; if (opts.logoutThrows) throw new Error('connection gone') },
          close() { seen.close++ },
        } as any,
        lastUsed: 0,
        lock: { release() { seen.release++; if (opts.lockThrows) throw new Error('lock gone') } } as any,
        folder: 'INBOX',
      },
    }
  }

  it('🔴 closes the socket even if `logout()` throws (common after 30 seconds idle)', async () => {
    const { seen, cached } = entryWith({ logoutThrows: true })
    await closeCachedConnection(cached)
    assert.equal(seen.close, 1, 'logout 실패가 close 를 삼켰다 — 종전 결함이 바로 이것')
  })

  it('🔴 continues to logout and close even if `lock.release()` throws (a single try would cut off here)', async () => {
    const { seen, cached } = entryWith({ lockThrows: true })
    await closeCachedConnection(cached)
    assert.equal(seen.logout, 1, 'lock 실패가 logout 을 건너뛰었다')
    assert.equal(seen.close, 1)
  })

  it('control: when healthy, tries graceful `logout()` first', async () => {
    const { seen, cached } = entryWith({})
    await closeCachedConnection(cached)
    assert.equal(seen.logout, 1, '정상 경로는 graceful 종료여야 한다(오류 경로와 다른 점)')
    assert.equal(seen.close, 1)
  })
})

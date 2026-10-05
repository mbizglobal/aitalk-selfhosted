
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

const GLOBAL_KEY = 'aitalkManagedRegionConfigCache'

const MODULE_PATH = new URL('./api-key.ts', import.meta.url).pathname

type CacheMap = Map<string, { config: unknown; expiry: number }>

describe('Managed region config cache: single instance within the same realm', () => {
  it('(A) reuses the Map already on the global; does not create its own Map', async () => {
    const g = globalThis as unknown as Record<string, CacheMap | undefined>

    assert.equal(
      g[GLOBAL_KEY],
      undefined,
      `${GLOBAL_KEY} 이 이미 채워져 있다 — 이 테스트보다 먼저 api-key 가 로드됐다. ` +
        '이 파일에 api-key 를 정적 import 하지 말 것(검증이 무력화된다).'
    )

    const seeded: CacheMap = new Map()
    g[GLOBAL_KEY] = seeded

    const mod = await import(MODULE_PATH)

    assert.equal(
      g[GLOBAL_KEY],
      seeded,
      '모듈이 전역 Map 을 자기 것으로 덮었다 — 컨텍스트마다 별개 캐시가 산다'
    )

    const probe = '__probe-region__'
    seeded.set(probe, { config: { apiKey: 'x' }, expiry: Date.now() + 60_000 })

    mod.invalidateRegionConfigCache(probe)

    assert.equal(
      seeded.has(probe),
      false,
      '무효화가 전역 Map 에 안 먹었다 — 모듈이 자기 지역 Map 을 쓰고 있다'
    )

    seeded.set('__a__', { config: {}, expiry: Date.now() + 60_000 })
    mod.invalidateRegionConfigCache()
    assert.equal(seeded.size, 0, '전체 무효화가 전역 Map 을 비우지 못했다')
  })

  it('(B) fills the global slot even under NODE_ENV=production', () => {
    const script = [
      `const ns = await import(${JSON.stringify(MODULE_PATH)});`,
      `const invalidate = ns.invalidateRegionConfigCache ?? ns.default?.invalidateRegionConfigCache;`,
      `if (typeof invalidate !== 'function') { console.log('NO_EXPORT:' + Object.keys(ns).join(',')); process.exit(1); }`,
      `const slot = globalThis[${JSON.stringify(GLOBAL_KEY)}];`,
      `if (!(slot instanceof Map)) { console.log('MISSING'); process.exit(1); }`,
      `slot.set('__p__', { config: {}, expiry: Date.now() + 60000 });`,
      `invalidate('__p__');`,
      `console.log(slot.has('__p__') ? 'DETACHED' : 'OK');`,
    ].join('\n')

    let out: string
    let failed = false
    try {
      out = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', stdio: 'pipe' }
      ).trim()
    } catch (e: any) {
      failed = true
      const childOut = String(e?.stdout ?? '').trim()
      const childErr = String(e?.stderr ?? '').trim()
      out =
        [childOut, childErr && `stderr: ${childErr}`].filter(Boolean).join('\n') ||
        String(e?.message ?? e)
    }

    assert.equal(failed, false, `자식 프로세스가 비정상 종료했다 (출력: ${out})`)

    assert.equal(
      out.split('\n').pop(),
      'OK',
      `prod 환경에서 전역 슬롯이 성립하지 않았다 (출력: ${out}). ` +
        'MISSING = 전역 대입이 prod 에서 안 일어남 (NODE_ENV 조건이 붙었다). ' +
        'DETACHED = 대입은 했지만 모듈이 다른 Map 을 쓰고 있음. ' +
        'NO_EXPORT = 자식에서 export 를 못 찾음(검증 불성립 — 조용히 통과시키지 않는다).'
    )
  })
})

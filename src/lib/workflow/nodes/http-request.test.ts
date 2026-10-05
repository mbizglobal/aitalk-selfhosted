import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { HttpRequestNodeExecutor } from './http-request'
import { WorkflowContext, WorkflowNode } from '../types'

//
//

const SECRETS = {
  bearerToken: 'BEARER_SECRET_VALUE',
  basicPassword: 'BASIC_SECRET_VALUE',
  hmacSecret: 'HMAC_SECRET_VALUE',
  hmacApiKey: 'HMAC_KEY_VALUE',
  authHeaderValue: 'HEADER_SECRET_VALUE',
}
const CUSTOM_HEADER_SECRET = 'CUSTOM_HEADER_SECRET_VALUE'

const httpNode = (data: Record<string, unknown>): WorkflowNode => ({
  id: 'http-1',
  type: 'custom',
  data: {
    nodeType: 'httpRequest',
    label: 'HTTP',
    ...SECRETS,
    headers: [{ key: 'X-Tenant-Key', value: CUSTOM_HEADER_SECRET }],
    ...data,
  },
  position: { x: 0, y: 0 },
} as unknown as WorkflowNode)

const context = () => ({ userId: 'user-1', agentId: 'agent-1', message: 'hi' } as unknown as WorkflowContext)

const prismaStub = undefined as unknown as PrismaClient

const executor = new HttpRequestNodeExecutor()

const leaked = (debug: unknown) => {
  const serialized = JSON.stringify(debug ?? {})
  return [...Object.values(SECRETS), CUSTOM_HEADER_SECRET].filter(s => serialized.includes(s))
}

test('single: a missing-URL failure does not put credentials in debug', async () => {
  const result = await executor.execute(
    httpNode({ mode: 'single', method: 'POST', authType: 'bearer' }),
    context(),
    prismaStub
  )

  assert.equal(result.debug?.status, 'error')
  assert.deepEqual(leaked(result.debug), [], '자격증명·커스텀 헤더 값이 debug 로 나가면 안 된다')
  assert.deepEqual(result.debug?.input, { method: 'POST', url: undefined, authType: 'bearer' })
})

test('multi: a missing-Base-URL failure does not put credentials in debug', async () => {
  const result = await executor.execute(
    httpNode({ mode: 'multi', authType: 'hmac', requests: [{ alias: 'a', path: '/x', enabled: true }] }),
    context(),
    prismaStub
  )

  assert.equal(result.debug?.status, 'error')
  assert.deepEqual(leaked(result.debug), [])
  assert.deepEqual(result.debug?.input, { mode: 'multi', baseUrl: '', authType: 'hmac', requestCount: 1 })
})

//
//
test('single + hmac sends no request and fails the node (no unauthenticated requests)', async () => {
  const result = await executor.execute(
    httpNode({ mode: 'single', method: 'GET', url: 'https://api.binance.com/api/v3/account', authType: 'hmac' }),
    context(),
    prismaStub
  )

  assert.equal(result.debug?.status, 'error')
  assert.match(String(result.debug?.error ?? result.error ?? ''), /only supported in multi mode/)
  assert.deepEqual(leaked(result.debug), [], '실패 경로도 자격증명을 debug 로 내보내면 안 된다')
})

const BLOCKED_URL = 'http://127.0.0.1/never-sent'
const SSRF_BLOCKED = /SSRF protection/

test('auth methods other than single + hmac are not blocked (no false rejection)', async () => {
  for (const authType of ['none', 'apiKey', 'bearer', 'basic']) {
    const result = await executor.execute(
      httpNode({ mode: 'single', method: 'GET', url: BLOCKED_URL, authType }),
      context(),
      prismaStub
    )
    assert.match(
      String(result.debug?.error ?? result.error ?? ''),
      SSRF_BLOCKED,
      `single + ${authType} 가 hmac 가드에 걸리면 안 된다`
    )
  }
})

test('multi + hmac does not hit the hmac guard; it is the only combination that works', async () => {
  const result = await executor.execute(
    httpNode({
      mode: 'multi',
      authType: 'hmac',
      baseUrl: BLOCKED_URL,
      requests: [{ alias: 'a', method: 'GET', path: '', enabled: true, signed: true }],
    }),
    context(),
    prismaStub
  )
  assert.match(String(JSON.stringify(result.debug ?? {}) + String(result.error ?? '')), SSRF_BLOCKED)
})

test('multi: a failure with 0 enabled requests does not put credentials in debug', async () => {
  const result = await executor.execute(
    httpNode({
      mode: 'multi',
      baseUrl: 'https://api.example.com',
      authType: 'basic',
      requests: [{ alias: 'a', path: '/x', enabled: false }],
    }),
    context(),
    prismaStub
  )

  assert.equal(result.debug?.status, 'error')
  assert.deepEqual(leaked(result.debug), [])
  assert.deepEqual(result.debug?.input, {
    mode: 'multi',
    baseUrl: 'https://api.example.com',
    authType: 'basic',
    requestCount: 1,
  })
})


import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkSafeExpressionSyntax, evaluateSafeExpression } from './safe-expression'
import { markTemplateVar } from './template-scope'

const ctx = (extra: Record<string, unknown> = {}): any => ({
  message: '주문을 취소하고 싶어요',
  aiResponse: 'OK',
  finalAnswer: 'done',
  agentId: 'a1',
  userId: 'u1',
  azureSearchConfig: { searchApiKey: 'PLATFORM-SEARCH-ADMIN-KEY' },
  ...extra,
})

describe('safe-expression: examples the UI shows work as is', () => {
  const c = ctx({
    jsonData: { needsRetry: true, category: 'urgent', score: 90, isApproved: false, amount: 150, status: 'review' },
  })

  it('example 1: AND', () => {
    assert.equal(evaluateSafeExpression('jsonData.needsRetry == true && jsonData.category == "urgent"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.needsRetry == true && jsonData.category == "spam"', c), false)
  })

  it('example 2: OR', () => {
    assert.equal(evaluateSafeExpression('jsonData.score > 85 || jsonData.isApproved == true', c), true)
    assert.equal(evaluateSafeExpression('jsonData.score > 95 || jsonData.isApproved == true', c), false)
  })

  it('example 3: nested parentheses, a shape Simple/Builder cannot express', () => {
    assert.equal(
      evaluateSafeExpression('jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")', c),
      true
    )
    assert.equal(
      evaluateSafeExpression('jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "closed")', c),
      false
    )
    assert.equal(
      evaluateSafeExpression('jsonData.amount > 500 && (jsonData.status == "pending" || jsonData.status == "review")', c),
      false
    )
  })

  it('system fields shown by the Fields panel', () => {
    assert.equal(evaluateSafeExpression('message == "주문을 취소하고 싶어요"', c), true)
    assert.equal(evaluateSafeExpression('aiResponse == "OK" && finalAnswer == "done"', c), true)
  })
})

describe('safe-expression: operators, literals, shapes', () => {
  const c = ctx({ jsonData: { n: 10, s: 'hello', flag: true, nothing: null, items: [{ uid: 7 }] } })

  it('all comparison operators', () => {
    assert.equal(evaluateSafeExpression('jsonData.n == 10', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n != 11', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n === 10', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n !== 10', c), false)
    assert.equal(evaluateSafeExpression('jsonData.n > 5', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n < 5', c), false)
    assert.equal(evaluateSafeExpression('jsonData.n >= 10', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n <= 9', c), false)
  })

  it('== is a loose comparison (same as the existing Simple mode)', () => {
    assert.equal(evaluateSafeExpression('jsonData.n == "10"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n === "10"', c), false)
  })

  it('negation, boolean and null literals', () => {
    assert.equal(evaluateSafeExpression('!jsonData.flag', c), false)
    assert.equal(evaluateSafeExpression('jsonData.flag', c), true)
    assert.equal(evaluateSafeExpression('jsonData.nothing == null', c), true)
    assert.equal(evaluateSafeExpression('!(jsonData.n > 100)', c), true)
  })

  it('array index paths', () => {
    assert.equal(evaluateSafeExpression('jsonData.items[0].uid == 7', c), true)
  })

  it('allowed string methods (arguments are literals only)', () => {
    assert.equal(evaluateSafeExpression('message.includes("취소")', ctx()), true)
    assert.equal(evaluateSafeExpression('message.includes("환불")', ctx()), false)
    assert.equal(evaluateSafeExpression('jsonData.s.startsWith("he")', c), true)
    assert.equal(evaluateSafeExpression('jsonData.s.endsWith("lo")', c), true)
  })

  it('the "context." prefix form also works', () => {
    assert.equal(evaluateSafeExpression('context.jsonData.n == 10', c), true)
  })

  it('empty expressions and non-strings are false', () => {
    assert.equal(evaluateSafeExpression('', c), false)
    assert.equal(evaluateSafeExpression('   ', c), false)
    assert.equal(evaluateSafeExpression(undefined as any, c), false)
    assert.equal(evaluateSafeExpression(123 as any, c), false)
  })

  it('literal true/false (old behavior preserved)', () => {
    assert.equal(evaluateSafeExpression('true', c), true)
    assert.equal(evaluateSafeExpression('false', c), false)
  })
})

describe('safe-expression: matches JS semantics (kimi R1)', () => {
  it('#1 `!` binds tighter than comparison: !a == b is (!a) == b', () => {
    const c = ctx({ jsonData: { n: 2, zero: 0, s: 'x' } })
    assert.equal(evaluateSafeExpression('!jsonData.n == true', c), false)
    assert.equal(evaluateSafeExpression('!jsonData.n == false', c), true)
    assert.equal(evaluateSafeExpression('!jsonData.zero == true', c), true)
    assert.equal(evaluateSafeExpression('!(jsonData.n == true)', c), true)
    assert.equal(evaluateSafeExpression('!jsonData.zero && jsonData.n > 1', c), true)
    assert.equal(evaluateSafeExpression('!jsonData.n && jsonData.n > 1', c), false)
  })

  it('#2 strings compare lexicographically (not Number coercion)', () => {
    const c = ctx({ jsonData: { status: 'review', n: 10 } })
    assert.equal(evaluateSafeExpression('jsonData.status > "m"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.status < "m"', c), false)
    assert.equal(evaluateSafeExpression('jsonData.status >= "review"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n > "5"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n < "5"', c), false)
  })

  it('#4 a method name without parentheses falls to an error rather than a function object', () => {
    const c = ctx({ jsonData: { s: 'hello' } })
    assert.equal(evaluateSafeExpression('jsonData.s.includes != null', c), false)
    assert.equal(evaluateSafeExpression('jsonData.s.startsWith', c), false)
    assert.equal(evaluateSafeExpression('jsonData.s.includes("ell")', c), true)
  })

  it('array/string .length is read as a path', () => {
    const c = ctx({ jsonData: { items: [1, 2, 3], s: 'abcd' } })
    assert.equal(evaluateSafeExpression('jsonData.items.length == 3', c), true)
    assert.equal(evaluateSafeExpression('jsonData.s.length > 3', c), true)
  })

  it('#R3-2 short-circuit: even if a blocked path is on the right, the left decides', () => {
    const c = ctx({ jsonData: { ok: true, no: false } })
    assert.equal(evaluateSafeExpression('true || azureSearchConfig.searchApiKey == 1', c), true)
    assert.equal(evaluateSafeExpression('jsonData.ok || azureSearchConfig.searchApiKey == 1', c), true)
    assert.equal(evaluateSafeExpression('false && azureSearchConfig.searchApiKey == 1', c), false)
    assert.equal(evaluateSafeExpression('jsonData.no && azureSearchConfig.searchApiKey == 1', c), false)
    assert.equal(evaluateSafeExpression('true && azureSearchConfig.searchApiKey == 1', c), false)
    assert.equal(evaluateSafeExpression('false || azureSearchConfig.searchApiKey != null', c), false)
  })

  it('#R3-3 string escapes: standard JS is interpreted, and unknown ones are errors', () => {
    const c = ctx({ jsonData: { r: 'a\rb', n: 'a\nb', u: 'aéb', x: 'a\x41b' } })
    assert.equal(evaluateSafeExpression('jsonData.r == "a\\rb"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.n == "a\\nb"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.u == "a\\u00e9b"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.x == "a\\x41b"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.r == "a\\qb"', c), false)
    assert.equal(evaluateSafeExpression('jsonData.r == "a\\u00zzb"', c), false)
  })

  it('#R3-3 unary minus: negative comparison', () => {
    const c = ctx({ jsonData: { neg: -1, pos: 3 } })
    assert.equal(evaluateSafeExpression('jsonData.neg < -0.5', c), true)
    assert.equal(evaluateSafeExpression('jsonData.neg == -1', c), true)
    assert.equal(evaluateSafeExpression('jsonData.pos > -1', c), true)
    assert.equal(evaluateSafeExpression('-jsonData.pos < 0', c), true)
  })

  it('#R3-3 unicode keys: Hangul JSON keys work, and invisible characters are rejected', () => {
    const c = ctx({ jsonData: { 이름: '홍길동', naïve: 1 } })
    assert.equal(evaluateSafeExpression('jsonData.이름 == "홍길동"', c), true)
    assert.equal(evaluateSafeExpression('jsonData.naïve == 1', c), true)
    assert.equal(evaluateSafeExpression('jsonData​.이름 == "홍길동"', c), false)
  })

  it('matches JS meaning (precedence and associativity check)', () => {
    const c = ctx({
      jsonData: { n: 2, zero: 0, s: 'review', t: true, f: false, nil: null, arr: [1, 2, 3], nested: { deep: 'v' } },
    })

    const CASES = [
      'jsonData.n > 1 && jsonData.n < 5 || jsonData.zero == 1',
      'jsonData.zero == 1 || jsonData.n > 1 && jsonData.n < 5',
      'true && false || true',
      'jsonData.n == 2 && jsonData.s == "review" || jsonData.f',
      '!jsonData.t || jsonData.n == 2',
      '!jsonData.t && jsonData.n == 2',
      '!!jsonData.n == true',
      '!jsonData.zero == true',
      '!jsonData.nil',
      '!(jsonData.n == 2 && jsonData.t)',
      'jsonData.n == 2 == true',
      'jsonData.n > 1 == true',
      'jsonData.n > 1 != false',
      'jsonData.n >= 2 == true',
      'jsonData.s == "review" == true',
      '!jsonData.zero == true == true',
      'jsonData.arr.length == 3 == true',
      'jsonData.n !== 2 == false',
      'true == true == true',
      '1 < jsonData.n',
      'jsonData.zero < jsonData.n',
      '(jsonData.n > 1) == true',
      'jsonData.s > "m" && jsonData.s < "z"',
      'jsonData.arr.length >= 3',
      'jsonData.nested.deep == "v"',
      'jsonData.nil == null',
      'jsonData.nil === null',
      'jsonData.f == false',
      'jsonData.arr[1] == 2',
      'message.includes("ell") && !jsonData.f',
    ]

    for (const expr of CASES) {
      // eslint-disable-next-line no-new-func
      const js = Boolean(new Function('jsonData', 'message', 'aiResponse', `return (${expr})`)(c.jsonData, c.message, c.aiResponse))
      assert.equal(evaluateSafeExpression(expr, c), js, `JS 와 결과가 다르다: ${expr}`)
    }
  })
})

describe('safe-expression: 🔴 leaks and RCE are impossible at the grammar stage', () => {
  it('globals (process/fetch/require/globalThis) cannot be read', () => {
    process.env.__SAFE_EXPR_TEST_SECRET = 'ENV-SECRET'
    const c = ctx()
    for (const expr of [
      'process.env.__SAFE_EXPR_TEST_SECRET == "ENV-SECRET"',
      'typeof fetch == "function"',
      'globalThis.process.env.HOME != null',
      'require("fs") != null',
    ]) {
      assert.equal(evaluateSafeExpression(expr, c), false, `전역에 도달했다: ${expr}`)
    }
    delete process.env.__SAFE_EXPR_TEST_SECRET
  })

  it('a function cannot be created through the constructor chain', () => {
    const c = ctx()
    for (const expr of [
      '"".constructor.constructor("return process")().env.HOME != null',
      'message.constructor.name == "String"',
      'jsonData.__proto__ != null',
    ]) {
      assert.equal(evaluateSafeExpression(expr, c), false, `프로토타입 체인이 뚫렸다: ${expr}`)
    }
  })

  it('secret paths are blocked at the gate; not even an oracle', () => {
    const c = ctx()
    const key = c.azureSearchConfig.searchApiKey as string
    for (const [a, b] of [
      [`azureSearchConfig.searchApiKey.startsWith("${key.slice(0, 3)}")`, 'azureSearchConfig.searchApiKey.startsWith("ZZZ")'],
      [`azureSearchConfig.searchApiKey == "${key}"`, 'azureSearchConfig.searchApiKey == "WRONG"'],
      ['azureSearchConfig.searchApiKey != null', 'azureSearchConfig.searchApiKey == null'],
    ]) {
      assert.equal(evaluateSafeExpression(a, c), false, `시크릿에 대해 참을 돌려줬다: ${a}`)
      assert.equal(evaluateSafeExpression(b, c), false)
    }
  })

  it('short-circuit does not bypass the gate; the result does not depend on the secret value', () => {
    const c = ctx({ jsonData: { ok: true, no: false } })

    for (const expr of [
      'false || azureSearchConfig.searchApiKey.startsWith("SEC")',
      'true && azureSearchConfig.searchApiKey.startsWith("SEC")',
      'jsonData.no || azureSearchConfig.searchApiKey != null',
      '(true || azureSearchConfig.searchApiKey == 1) && azureSearchConfig.searchApiKey != null',
      '(false && azureSearchConfig.searchApiKey == 1) || azureSearchConfig.searchApiKey != null',
    ]) {
      assert.equal(evaluateSafeExpression(expr, c), false, `시크릿 가지가 평가됐다: ${expr}`)
    }

    for (const expr of [
      'true || (true || azureSearchConfig.searchApiKey == 1)',
      'true || (false && azureSearchConfig.searchApiKey == 1)',
    ]) {
      assert.equal(evaluateSafeExpression(expr, c), true, `단축 평가가 안 됐다: ${expr}`)
    }

    const forms = [
      'azureSearchConfig.searchApiKey.startsWith("A")',
      'true || azureSearchConfig.searchApiKey.startsWith("A")',
      'jsonData.ok && azureSearchConfig.searchApiKey == "A"',
      '!(azureSearchConfig.searchApiKey == "A")',
    ]
    for (const expr of forms) {
      const withA = evaluateSafeExpression(expr, ctx({ jsonData: { ok: true }, azureSearchConfig: { searchApiKey: 'AAA' } }))
      const withZ = evaluateSafeExpression(expr, ctx({ jsonData: { ok: true }, azureSearchConfig: { searchApiKey: 'ZZZ' } }))
      assert.equal(withA, withZ, `시크릿 값에 따라 결과가 갈린다(oracle): ${expr}`)
    }
  })

  it('the gate stays alive even after a skip (no counter leak)', () => {
    const c = ctx()
    for (let i = 0; i < 3; i++) {
      assert.equal(evaluateSafeExpression('true || azureSearchConfig.searchApiKey == 1', c), true)
      assert.equal(evaluateSafeExpression('azureSearchConfig.searchApiKey != null', c), false)
    }
  })

  it('look-alike unicode characters cannot disguise allowlist or registry names', async () => {
    const { canReadTemplatePath, markTemplateVar } = await import('./template-scope')
    const c: any = ctx()
    markTemplateVar(c, 'currentReceipt')
    markTemplateVar(c, '이름')

    for (const path of [
      'ａzureSearchConfig.searchApiKey',
      'azureSearchConfıg.searchApiKey',    // dotless i
      'AZURESEARCHCONFIG.searchApiKey',
      'ｍessage',
      'currentReceipť',
      'ＣurrentReceipt',
    ]) {
      assert.equal(canReadTemplatePath(c, path), false, `유니코드 위장이 통과했다: ${JSON.stringify(path)}`)
    }
    assert.equal(canReadTemplatePath(c, '이름.x'), true)
    assert.equal(canReadTemplatePath(c, 'currentReceipt'), true)
  })

  it('astral-plane unicode keys are also read as identifiers', () => {
    const c = ctx({ jsonData: { '𝐀bc': 1, '𠀋': 2 } })
    assert.equal(evaluateSafeExpression('jsonData.𝐀bc == 1', c), true)
    assert.equal(evaluateSafeExpression('jsonData.𠀋 == 2', c), true)
  })

  it('security and billing decision fields cannot be read even when registered', async () => {
    const { canReadTemplatePath } = await import('./template-scope')
    const c: any = ctx({ userId: 'u', isManaged: true, managedRegion: 'swiss', skipAiCallCpa: true, chatSummary: 'S' })
    c.__templateVars = Object.keys(c)

    for (const k of ['userId', 'isManaged', 'managedRegion', 'skipAiCallCpa', 'isTestMode', 'chatSummary', 'previousResponseId', 'workflowId', 'azureSearchConfig']) {
      assert.equal(canReadTemplatePath(c, k), false, `등록만으로 "${k}" 가 열렸다`)
    }
    assert.equal(canReadTemplatePath(c, 'jsonData'), true)
  })

  it('arithmetic is not supported and does not silently go wrong', () => {
    const c = ctx({ jsonData: { n: 2 } })
    assert.equal(evaluateSafeExpression('5 - 3 == 2', c), false)
    assert.equal(evaluateSafeExpression('jsonData.n - 1 == 1', c), false)
    assert.equal(evaluateSafeExpression('- -1 == 1', c), true)
    assert.equal(evaluateSafeExpression('!-1', c), false)
  })

  it('calls to methods outside the allow list are rejected', () => {
    const c = ctx({ jsonData: { s: 'x' } })
    for (const expr of [
      'jsonData.s.replace("x","y") == "y"',
      'jsonData.s.toString() == "x"',
      'jsonData.s.at(0) == "x"',
    ]) {
      assert.equal(evaluateSafeExpression(expr, c), false, `임의 메서드가 실행됐다: ${expr}`)
    }
  })

  it('a path cannot be passed as a method argument to bypass', () => {
    const c = ctx()
    assert.equal(evaluateSafeExpression('message.includes(azureSearchConfig.searchApiKey)', c), false)
  })

  it('assignment, sequence, template literals and arrow functions fall to a syntax error', () => {
    const c = ctx({ jsonData: { n: 1 } })
    for (const expr of [
      'jsonData.n = 5',
      'jsonData.n, process.env.HOME',
      '`${process.env.HOME}` != null',
      '(() => process.env.HOME)() != null',
      'new Function("return process")().env.HOME != null',
    ]) {
      assert.equal(evaluateSafeExpression(expr, c), false, `허용되면 안 되는 문법이 통과했다: ${expr}`)
    }
  })

  it('registered dynamic variables are read, and blocked before registration', () => {
    const c = ctx({ currentReceipt: { amount: 54 } })
    assert.equal(evaluateSafeExpression('currentReceipt.amount > 50', c), false)
    markTemplateVar(c, 'currentReceipt')
    assert.equal(evaluateSafeExpression('currentReceipt.amount > 50', c), true)
  })

  it('all tokenizer and parser bypass attempts (unicode, comments, bracket strings, globals, broken syntax)', () => {
    const c = ctx({ jsonData: { n: 1, s: 'x' } })
    const MUST_BE_FALSE = [
      'azureSearchConfig​.searchApiKey != null',
      'ازureSearchConfig.searchApiKey != null',
      'context["azureSearchConfig"].searchApiKey != null',
      "context['azureSearchConfig'] != null",
      'azureSearchConfig["searchApiKey"] != null',
      'azureSearchConfig . searchApiKey != null',
      'azureSearchConfig/*x*/.searchApiKey != null',
      'AzureSearchConfig.searchApiKey != null',
      'context.context.azureSearchConfig.searchApiKey != null',
      'this.process != null',
      'arguments != null',
      'eval("1") == 1',
      'Function != null',
      'Object.keys(jsonData).length > 0',
      'jsonData.n ==',
      '== 1',
      '&& true',
      '()',
      'jsonData.',
      'jsonData[',
      'jsonData[-1] != null',
      'jsonData[1.5] != null',
      '"unterminated',
      'jsonData.s.includes("a", "b") == true',
      'jsonData.s.includes(jsonData.s) == true',
    ]
    for (const expr of MUST_BE_FALSE) {
      assert.equal(evaluateSafeExpression(expr, c), false, `우회했다: ${JSON.stringify(expr)}`)
    }
  })

  it('the gate does not over-block normal paths (array indexes, numeric keys)', async () => {
    const { canReadTemplatePath } = await import('./template-scope')
    const c = ctx()
    for (const path of [
      'jsonData.a.b.c',
      'httpResult[0]',
      'imapResult.emails[0].uid',
      'jsonData.items[10].x',
      'message',
      'jsonData.0',
      'httpResult.data.0.name',
    ]) {
      assert.equal(canReadTemplatePath(c, path), true, `정상 경로가 차단됐다: ${path}`)
    }
  })

  it('excessive input is rejected (prevents parse blowup)', () => {
    const c = ctx({ jsonData: { n: 1 } })
    assert.equal(evaluateSafeExpression('('.repeat(500) + 'jsonData.n' + ')'.repeat(500), c), false)
    assert.equal(evaluateSafeExpression('jsonData.n == 1 && '.repeat(300) + 'true', c), false)
  })
})

describe('safe-expression: the browser (Studio Test panel) uses the same evaluator', () => {
  it('client evaluateCustomExpression produces the same result as the server', async () => {
    const { evaluateCustomExpression } = await import('@/app/app/agent-studio/utils/conditionEvaluator')
    const vars: any = { jsonData: { amount: 150, status: 'review', n: 2 }, message: 'hi' }

    for (const expr of [
      'jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")',
      '!jsonData.n == true',
      'jsonData.n > 1 == true',
      'message.includes("h")',
      'jsonData.status > "m"',
    ]) {
      assert.equal(
        evaluateCustomExpression(vars, expr),
        evaluateSafeExpression(expr, { ...vars, __templateVars: Object.keys(vars) }),
        `클라이언트/서버 결과가 다르다: ${expr}`
      )
    }
  })

  it('client Simple/Builder also goes through the same gate', async () => {
    const m = await import('@/app/app/agent-studio/utils/conditionEvaluator')
    const vars: any = { jsonData: { n: 5 }, azureSearchConfig: { searchApiKey: 'SECRET' }, userId: 'u' }

    assert.equal(m.evaluateSimpleCondition(vars, 'jsonData', '!=', null), true)
    assert.equal(m.evaluateSimpleCondition(vars, 'azureSearchConfig', '!=', null), false)
    assert.equal(m.evaluateSimpleCondition(vars, 'userId', '==', 'u'), false)
    assert.equal(
      m.evaluateBuilderConditions(vars, 'any', [{ field: 'azureSearchConfig', operator: '!=', value: null }]),
      false
    )
  })

  it('globals are unreachable on the client too', async () => {
    const { evaluateCustomExpression } = await import('@/app/app/agent-studio/utils/conditionEvaluator')
    for (const expr of [
      'process.env.HOME != null',
      'typeof fetch == "function"',
      '"".constructor.constructor("return 1")() == 1',
    ]) {
      assert.equal(evaluateCustomExpression({ jsonData: {} }, expr), false, `전역에 도달했다: ${expr}`)
    }
  })
})

describe('safe-expression: If/Else and While call-site wiring', () => {
  it('evaluateCondition (conditionMode: code) goes through the parser', async () => {
    const { evaluateCondition } = await import('./utils')
    const c = ctx({ jsonData: { amount: 150, status: 'review' } })

    for (const conditionMode of ['advanced', 'code']) {
      assert.equal(
        evaluateCondition(c, {
          conditionMode,
          customExpression: 'jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")',
        }),
        true
      )
      assert.equal(
        evaluateCondition(c, { conditionMode, customExpression: 'process.env.HOME != null' }),
        false
      )
    }
  })
})

describe('checkSafeExpressionSyntax: authoring-time syntax check (does not evaluate)', () => {
  it('examples the UI shows and normal syntax pass', () => {
    for (const expr of [
      'jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")',
      '!message.includes("취소")',
      'jsonData.items[0].status === "done"',
      'jsonData.n < -0.5',
      'a > 1 == true',
      'aiResponse.startsWith("OK") || finalAnswer.endsWith("done")',
    ]) {
      assert.equal(checkSafeExpressionSyntax(expr), null, `통과해야: ${expr}`)
    }
  })

  it('anything outside the grammar returns a reason; these currently silently become false', () => {
    for (const expr of [
      'jsonData.n > 1 ? "a" : "b"',
      'jsonData.a + jsonData.b > 3',
      'typeof jsonData.a == "string"',
      'jsonData["key"] == 1',
      'jsonData.list.map(x)',
      'jsonData.amount >',
      'jsonData.a = 1',
      'fetch("https://x") || true',
    ]) {
      assert.ok(checkSafeExpressionSyntax(expr), `거부돼야: ${expr}`)
    }
  })

  it('empty values and non-strings also return a reason; the same symptom as the engine dropping straight to false', () => {
    for (const v of [undefined, null, '', '   ', 42, ['a'], {}]) {
      assert.ok(checkSafeExpressionSyntax(v), `거부돼야: ${JSON.stringify(v)}`)
    }
  })

  it('🔴 does not read the context: unregistered variables and secret paths pass if the syntax is right', () => {
    assert.equal(checkSafeExpressionSyntax('myLoopVar.total > 0'), null)
    assert.equal(checkSafeExpressionSyntax('azureSearchConfig.searchApiKey != null'), null)
  })

  it('🔴 the check has no side effects: evaluating the same expression still gets blocked by the gate', () => {
    assert.equal(evaluateSafeExpression('azureSearchConfig.searchApiKey != null', ctx()), false)
  })

  it('🔴 pins the help text so it does not diverge from the real parser grammar', () => {
    const help = checkSafeExpressionSyntax('jsonData.a + jsonData.b > 3')!
    assert.match(help, /binary arithmetic/, '이항 산술만 미지원임을 명시해야')
    assert.match(help, /unary -/, '단항 마이너스 지원을 명시해야')

    assert.equal(checkSafeExpressionSyntax('jsonData.n < -0.5'), null)
    assert.equal(checkSafeExpressionSyntax('-jsonData.n < 0'), null)
    assert.equal(checkSafeExpressionSyntax('-(jsonData.n) < 0'), null)
  })

  it('lengths over the cap are rejected before parsing', () => {
    assert.ok(checkSafeExpressionSyntax(`a == "${'x'.repeat(2100)}"`))
  })
})

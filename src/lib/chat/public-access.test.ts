
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import {
  isPublicChatSource,
  isWorkflowPubliclyAccessible,
  isTeamChatWorkflow,
  PRIVILEGED_CHAT_SOURCES,
} from './public-access'

describe('isPublicChatSource: only privileged sources skip the public check', () => {
  it('a source with an authentication branch is not public', () => {
    for (const s of ['playground', 'workflow-playground', 'team']) {
      assert.equal(isPublicChatSource(s), false, `${s} 는 라우트가 자체 인증한다`)
    }
  })

  it('the widget is public (the only source that was already checked before)', () => {
    assert.equal(isPublicChatSource('widget'), true)
  })

  it('RED: external is public: this was the actual hole', () => {
    assert.equal(
      isPublicChatSource('external'),
      true,
      'external 은 body 기본값이라 아무나 보낼 수 있다 — 검사를 받아야 한다',
    )
  })

  it('other embed sources such as iframe and gitbook are public too', () => {
    assert.equal(isPublicChatSource('iframe'), true)
    assert.equal(isPublicChatSource('gitbook'), true)
  })
})

describe('isPublicChatSource: fail-closed (check when unsure)', () => {
  it('an unseen value is classified as public', () => {
    for (const s of ['brand-new-embed', 'partner-api', 'v2-widget', 'WIDGET', 'Team']) {
      assert.equal(isPublicChatSource(s), true, `모르는 '${s}' 가 검사를 면제받으면 안 된다`)
    }
  })

  it('different letter case is not privileged (must match exactly)', () => {
    assert.equal(isPublicChatSource('TEAM'), true)
    assert.equal(isPublicChatSource('Playground'), true)
  })

  it('empty or missing values are also classified as public', () => {
    assert.equal(isPublicChatSource(undefined), true)
    assert.equal(isPublicChatSource(null), true)
    assert.equal(isPublicChatSource(''), true)
  })

  it('mixed-in whitespace is not privileged (no trim)', () => {
    assert.equal(isPublicChatSource(' team'), true)
    assert.equal(isPublicChatSource('team '), true)
  })
})

describe('PRIVILEGED_CHAT_SOURCES: the exemption list is intentionally narrow', () => {
  it('exactly 3 sources are exempt', () => {
    assert.equal(PRIVILEGED_CHAT_SOURCES.size, 3)
    assert.deepEqual(
      [...PRIVILEGED_CHAT_SOURCES].sort(),
      ['playground', 'team', 'workflow-playground'],
    )
  })
})

const startNode = (accessMode?: string) => ({
  id: 'n1',
  data: { nodeType: 'start', ...(accessMode ? { accessMode } : {}) },
})

describe('isWorkflowPubliclyAccessible: default behavior', () => {
  it('opens if start is public', () => {
    assert.equal(isWorkflowPubliclyAccessible([startNode('public')], 'public'), true)
  })

  it('blocks if start is team', () => {
    assert.equal(isWorkflowPubliclyAccessible([startNode('team')], 'public'), false)
  })

  it('inherits the account value if start has no accessMode', () => {
    assert.equal(isWorkflowPubliclyAccessible([startNode()], 'public'), true)
    assert.equal(isWorkflowPubliclyAccessible([startNode()], 'team'), false)
  })

  it('follows the account value if there is no start candidate (keeps the previous fallback)', () => {
    const nodes = [{ id: 'ai-1', data: { nodeType: 'ai' } }]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'team'), false)
  })
})

describe('isWorkflowPubliclyAccessible: guard against judge drift (#1)', () => {
  it('RED: with several candidates, blocks if even one is private', () => {
    const nodes = [
      { id: '1', data: { label: 'Start', accessMode: 'public' } },
      { id: 'n2', data: { nodeType: 'start', accessMode: 'team' } },
    ]
    assert.equal(
      isWorkflowPubliclyAccessible(nodes, 'public'),
      false,
      '실제 start 가 team 인데 앞선 후보가 public 이라 통과하면 안 된다',
    )
  })

  it('every shape the executor sees as start is a candidate', () => {
    const byType = [{ id: 'x', type: 'start', data: { accessMode: 'team' } }]
    const byNodeType = [{ id: 'x', type: 'custom', data: { nodeType: 'start', accessMode: 'team' } }]
    const byLabel = [{ id: 'x', data: { label: 'Start', accessMode: 'team' } }]

    for (const [name, nodes] of Object.entries({ byType, byNodeType, byLabel })) {
      assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), false, `${name} 후보를 놓쳤다`)
    }
  })

  it('blocks if the node is team even when the account is public (all prod agents are public)', () => {
    assert.equal(isWorkflowPubliclyAccessible([startNode('team')], 'public'), false)
  })
})

describe('isWorkflowPubliclyAccessible: invalid input falls back to the account value', () => {
  it('treats nodes as 0 candidates if it is not an array', () => {
    for (const bad of [undefined, null, 'nodes', 42, {}]) {
      assert.equal(isWorkflowPubliclyAccessible(bad, 'team'), false, `${JSON.stringify(bad)} → team 이면 막아야 한다`)
      assert.equal(isWorkflowPubliclyAccessible(bad, 'public'), true)
    }
  })

  it('treats empty agentAccessMode as public (same as the previous fallback)', () => {
    assert.equal(isWorkflowPubliclyAccessible([startNode()], undefined), true)
  })
})

describe('isWorkflowPubliclyAccessible: does not diverge from the executor\'s judgment (#1)', () => {
  it('RED: treated as start even if the label is lowercase, as the executor does', () => {
    const nodes = [{ id: 'x', type: 'custom', data: { label: 'start', accessMode: 'team' } }]
    assert.equal(
      isWorkflowPubliclyAccessible(nodes, 'public'),
      false,
      '실행기는 start 로 보는데 게이트가 놓치면 team 워크플로가 공개로 내려앉는다',
    )
  })

  it('all label case variants: START / Start / sTaRt / chat widget', () => {
    for (const label of ['START', 'Start', 'sTaRt', 'chat widget', 'CHAT WIDGET', 'Chat Widget']) {
      const nodes = [{ id: 'x', type: 'custom', data: { label, accessMode: 'team' } }]
      assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), false, `label='${label}' 을 놓쳤다`)
    }
  })

  it('node.type === "start" is also caught by the executor\'s judgment', () => {
    const nodes = [{ id: 'x', type: 'start', data: { accessMode: 'team' } }]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), false)
  })
})

describe('isWorkflowPubliclyAccessible: if an accessMode value exists, that value is the verdict (#3)', () => {
  it('RED: an empty string is not public, and does not revert to the account value', () => {
    const nodes = [{ id: 'n1', data: { nodeType: 'start', accessMode: '' } }]
    assert.equal(
      isWorkflowPubliclyAccessible(nodes, 'public'),
      false,
      "accessMode:'' 를 계정 public 으로 상속하면 '하나라도 public 이 아니면 거부' 계약이 깨진다",
    )
  })

  it('an unknown value is not public either', () => {
    for (const v of ['private', 'PUBLIC', 'Public', 'internal', ' public']) {
      const nodes = [{ id: 'n1', data: { nodeType: 'start', accessMode: v } }]
      assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), false, `accessMode='${v}' 가 통과했다`)
    }
  })

  it('inherits the account value only when the property is absent altogether', () => {
    const nodes = [{ id: 'n1', data: { nodeType: 'start' } }]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'team'), false)
  })
})

describe('isWorkflowPubliclyAccessible: nodes the engine does not see as start are not part of the verdict (#2)', () => {
  it('RED: an AI node with id "1" must not block the whole workflow', () => {
    const nodes = [
      { id: '1', type: 'ai', data: { accessMode: 'team' } },
      { id: 's', type: 'start', data: { accessMode: 'public' } },
    ]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
  })

  it('a non-start node with id "start" is not part of the verdict either', () => {
    const nodes = [
      { id: 'start', type: 'ai', data: { accessMode: 'team' } },
      { id: 's', type: 'start', data: { accessMode: 'public' } },
    ]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
  })

  it('node.type takes priority, so leftover data.nodeType:chat_widget is ignored', () => {
    const nodes = [
      { id: 'x', type: 'ai', data: { nodeType: 'chat_widget', accessMode: 'team' } },
      { id: 's', type: 'start', data: { accessMode: 'public' } },
    ]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
  })

  it('even if the label is start, node.type wins when it is a supported type', () => {
    const nodes = [
      { id: 'x', type: 'ai', data: { label: 'start', accessMode: 'team' } },
      { id: 's', type: 'start', data: { accessMode: 'public' } },
    ]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
  })
})

describe('isWorkflowPubliclyAccessible: accessMode null boundary (#3)', () => {
  it('null inherits the account value, same as an absent property', () => {
    const nodes = [{ id: 'n1', data: { nodeType: 'start', accessMode: null } }]
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'public'), true)
    assert.equal(isWorkflowPubliclyAccessible(nodes, 'team'), false)
  })
})


describe('info route wiring: does not put the workflow body in the response', () => {
  const INFO_ROUTE = 'src/app/api/chat/[agentId]/info/route.ts'
  const infoSrc = readFileSync(path.resolve(__dirname, '../../..', INFO_ROUTE), 'utf8')
  const infoSf = ts.createSourceFile(INFO_ROUTE, infoSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const walk = (root: ts.Node, fn: (n: ts.Node) => void) => {
    const visit = (n: ts.Node) => { fn(n); ts.forEachChild(n, visit) }
    ts.forEachChild(root, visit)
  }

  const insideCatch = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isCatchClause(p)) return true
    return false
  }

  const ALLOWED_RESPONSE_FIELDS = new Set([
    'id', 'title', 'vectorStoreId', 'accessMode', 'authorized', 'ownerAuthorized',
    'member', 'reason', 'rateLimitSettings', 'widgetSettings', 'fileInput', 'workflowMode',
    'error',
  ])

  const getHandler = (): ts.FunctionDeclaration => {
    let fn: ts.FunctionDeclaration | null = null
    walk(infoSf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'GET') fn = n
    })
    assert.ok(fn, '`GET` 핸들러를 못 찾았다 — 아래 검사가 전부 무의미해졌다')
    return fn!
  }

  const returnsInGet = (): ts.ReturnStatement[] => {
    const out: ts.ReturnStatement[] = []
    walk(getHandler(), (n) => { if (ts.isReturnStatement(n)) out.push(n) })
    return out
  }

  const responseObjects = (): ts.ObjectLiteralExpression[] => {
    const out: ts.ObjectLiteralExpression[] = []
    walk(infoSf, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'json' &&
        n.expression.expression.getText() === 'NextResponse' &&
        n.arguments.length > 0 &&
        ts.isObjectLiteralExpression(n.arguments[0])
      ) out.push(n.arguments[0] as ts.ObjectLiteralExpression)
    })
    return out
  }

  const localBindingsOf = (name: string): ts.Node[] => {
    const out: ts.Node[] = []
    walk(infoSf, (n) => {
      const named =
        ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) ||
        ts.isParameter(n) || ts.isBindingElement(n)
      if (named && n.name && ts.isIdentifier(n.name) && n.name.text === name) out.push(n)
    })
    return out
  }

  const accessModeAssignments = (): ts.BinaryExpression[] => {
    const out: ts.BinaryExpression[] = []
    walk(infoSf, (n) => {
      if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
      if (ts.isIdentifier(n.left) && n.left.text === 'finalAccessMode') { out.push(n); return }
      if (ts.isObjectLiteralExpression(n.left) || ts.isArrayLiteralExpression(n.left)) {
        let hit = false
        walk(n.left, (m) => { if (ts.isIdentifier(m) && m.text === 'finalAccessMode') hit = true })
        if (hit) out.push(n)
      }
    })
    return out
  }

  it('RED (a1) every exit of `GET` is `NextResponse.json(<object literal>)`', () => {
    const rets = returnsInGet()
    assert.ok(rets.length > 0, '`GET` 에 return 이 없다 — 검사가 무의미해졌다')

    for (const r of rets) {
      const e = r.expression
      const ok =
        !!e && ts.isCallExpression(e) &&
        ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === 'json' &&
        e.expression.expression.getText() === 'NextResponse' &&
        e.arguments.length > 0 &&
        ts.isObjectLiteralExpression(e.arguments[0])
      assert.ok(
        ok,
        `\`GET\` 의 출구가 \`NextResponse.json(<객체 리터럴>)\` 이 아니다: \`${r.getText().slice(0, 120)}\`\n` +
          '  ⚠️ 이것은 **의도한 제약**이다 — 응답을 변수·헬퍼·다른 Response 로 빼면 무엇이 나가는지 ' +
          '소스로 못 읽고, 이 라우트는 인증이 없어 그 대가가 크다. 정말 필요하면 이 검사부터 고칠 것.',
      )
    }
  })

  it('RED (a2) no value derived from the workflow body flows into the response', () => {
    //      fileInput: access.authorized ? workflowJson : null
    //      widgetSettings: { workflowJson }
    const TAINTED = new Set(['workflowJson', 'workflow', 'nodes', 'aiNode', 'workflowData'])
    for (const r of returnsInGet()) {
      const hits: string[] = []
      walk(r, (n) => {
        if (ts.isIdentifier(n) && TAINTED.has(n.text)) {
          const p = n.parent
          const isNameSlot =
            (ts.isPropertyAssignment(p) || ts.isPropertyAccessExpression(p)) && (p as any).name === n
          if (!isNameSlot) hits.push(n.text)
        }
      })
      assert.deepEqual(
        hits, [],
        `응답 식에 워크플로 본문 유래 값이 섞였다(${hits.join(', ')}): \`${r.getText().slice(0, 120)}\`\n` +
          '  위젯에 필요한 것은 파생 불리언 3개뿐이다 — 본문·노드·엣지는 내보내지 않는다.',
      )
    }
  })

  it('RED (a3) response fields are an allowlist only: no spread or computed properties', () => {
    const objs = returnsInGet()
      .map((r) => (r.expression as ts.CallExpression | undefined)?.arguments?.[0])
      .filter((a): a is ts.ObjectLiteralExpression => !!a && ts.isObjectLiteralExpression(a))
    assert.ok(objs.length > 0, '출구 객체를 하나도 못 찾았다 — 이 검사가 무의미해졌다')

    for (const o of objs) {
      for (const p of o.properties) {
        assert.ok(
          !ts.isSpreadAssignment(p),
          `응답 객체에 spread 가 있다(\`${p.getText()}\`) — 무엇이 실리는지 이름으로 확인할 수 없다`,
        )
        assert.ok(
          ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p),
          `응답 객체에 예상 못한 프로퍼티 형태가 있다: \`${p.getText()}\``,
        )
        assert.ok(
          !ts.isComputedPropertyName((p as ts.PropertyAssignment).name),
          `응답 객체에 계산 프로퍼티가 있다: \`${p.getText()}\``,
        )
        const name = (p as ts.PropertyAssignment | ts.ShorthandPropertyAssignment).name.getText()
        assert.ok(
          ALLOWED_RESPONSE_FIELDS.has(name),
          `응답에 허용목록 밖 필드 \`${name}\` 가 실렸다 — ` +
            '무인증 호출자에게 줄 값인지 판단하고 ALLOWED_RESPONSE_FIELDS 에 근거와 함께 더할 것',
        )
      }
    }

    const main = objs.find((o) =>
      o.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name.getText() === 'accessMode'))
    assert.ok(main, '`accessMode` 를 싣는 응답 객체를 못 찾았다')
    const names = main!.properties.map((p) => (p as ts.PropertyAssignment).name?.getText())
    assert.ok(names.includes('fileInput'), '본 응답에 `fileInput` 이 없다 — 파생 플래그가 사라졌다')
  })

  it('RED (b) accessMode is assigned in exactly 2 places: the canonical judgment and catch', () => {
    assert.deepEqual(
      localBindingsOf('isWorkflowPubliclyAccessible'), [],
      '`isWorkflowPubliclyAccessible` 를 파일 안에서 재선언했다 — import 정본이 가려진다',
    )

    const assigns = accessModeAssignments()
    assert.equal(
      assigns.length, 2,
      `\`finalAccessMode\` 대입이 ${assigns.length}곳이다(2곳이어야 한다) — ` +
        '대입이 늘면 마지막 값이 무엇인지 소스로 판정할 수 없다: ' +
        assigns.map((a) => a.getText()).join(' · '),
    )

    const canonical = assigns.find((a) => {
      const r = a.right
      if (!ts.isConditionalExpression(r)) return false
      const cond = r.condition
      const isCanonicalCall =
        ts.isCallExpression(cond) &&
        ts.isIdentifier(cond.expression) &&
        cond.expression.text === 'isWorkflowPubliclyAccessible' &&
        cond.arguments.length === 2 &&
        cond.arguments[0].getText() === 'nodes' &&
        cond.arguments[1].getText() === 'agent.accessMode'
      return isCanonicalCall &&
        ts.isStringLiteral(r.whenTrue) && r.whenTrue.text === 'public' &&
        ts.isStringLiteral(r.whenFalse) && r.whenFalse.text === 'team'
    })
    assert.ok(
      canonical,
      '`finalAccessMode = isWorkflowPubliclyAccessible(…) ? \'public\' : \'team\'` 형태가 없다 — ' +
        '판정을 복제하거나 결과를 버리면 실행 게이트와 어긋난다',
    )
    assert.ok(!insideCatch(canonical!), '정본 판정이 catch 안에 있다 — 정상 경로에서 안 돈다')

  })

  it('RED (c) the AI node judgment is only a `resolveNodeType(...) === \'ai\'` comparison', () => {
    assert.deepEqual(
      localBindingsOf('resolveNodeType'), [],
      '`resolveNodeType` 을 파일 안에서 재선언했다 — 엔진 정본이 가려진다',
    )

    const comparisons: ts.BinaryExpression[] = []
    walk(infoSf, (n) => {
      if (
        ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
      ) {
        const lit = ts.isStringLiteral(n.right) ? n.right : ts.isStringLiteral(n.left) ? n.left : null
        if (lit && lit.text.toLowerCase() === 'ai') comparisons.push(n)
      }
    })
    assert.ok(comparisons.length > 0, "'ai' 비교가 하나도 없다 — AI 노드 판정이 사라졌다")

    for (const c of comparisons) {
      const other = ts.isStringLiteral(c.right) ? c.left : c.right
      assert.ok(
        ts.isCallExpression(other) &&
          ts.isIdentifier(other.expression) &&
          other.expression.text === 'resolveNodeType',
        `손으로 옮긴 AI 노드 판정이 있다: \`${c.getText()}\` — ` +
          '판정자를 복제하면 레거시 노드(`label:\'AI\'`·`type:\'ai\'`)에서 서로 놓치는 것이 갈린다',
      )

      const arg = (other as ts.CallExpression).arguments[0]
      assert.ok(arg && ts.isIdentifier(arg), `\`resolveNodeType\` 인자가 식별자가 아니다: \`${c.getText()}\``)
      let enclosingParam: string | null = null
      for (let p: ts.Node | undefined = c.parent; p; p = p.parent) {
        if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
          const first = p.parameters[0]
          if (first && ts.isIdentifier(first.name)) enclosingParam = first.name.text
          break
        }
      }
      assert.equal(
        (arg as ts.Identifier).text, enclosingParam,
        `\`resolveNodeType\` 에 순회 중인 노드가 아닌 값을 넘긴다: \`${c.getText()}\` ` +
          `(콜백 파라미터는 \`${enclosingParam}\`)`,
      )
    }
  })

  it('RED (d) a workflowJson parse failure is fail-closed', () => {
    const assigns = accessModeAssignments()
    const inCatch = assigns.filter((a) => insideCatch(a))
    assert.equal(
      inCatch.length, 1,
      `catch 안의 \`finalAccessMode\` 대입이 ${inCatch.length}곳이다(1곳이어야 한다) — ` +
        '두 곳이면 마지막 값이 무엇인지 알 수 없다',
    )
    assert.ok(
      ts.isStringLiteral(inCatch[0].right) && inCatch[0].right.text === 'team',
      `파싱 catch 가 \`${inCatch[0].getText()}\` 로 닫는다 — ` +
        "`'team'` 이어야 한다. 계정 모드로 폴백하면 prod 에이전트가 전부 public 이라 «깨지면 열린다»",
    )
  })
})

describe('isTeamChatWorkflow: the team chat list only has "chat + team" workflows', () => {
  const start = (data: Record<string, unknown>) => ({ id: 's', data: { nodeType: 'start', ...data } })

  it('a chat widget plus team can be chosen', () => {
    assert.equal(isTeamChatWorkflow([start({ triggerType: 'chatWidget', accessMode: 'team' })], 'public'), true)
  })

  it('an old chat start node without a kind value is also treated as chat', () => {
    assert.equal(isTeamChatWorkflow([start({ accessMode: 'team' })], 'public'), true)
  })

  it('when the setting is empty, continues the agent value', () => {
    assert.equal(isTeamChatWorkflow([start({ triggerType: 'chatWidget' })], 'team'), true)
    assert.equal(isTeamChatWorkflow([start({ triggerType: 'chatWidget' })], 'public'), false)
    assert.equal(isTeamChatWorkflow([start({ triggerType: 'chatWidget' })], null), false)
  })

  it('public widget, phone, telegram, schedule and sub are excluded (2026-09-23 dev screen: the public widget and phone showed up in the list)', () => {
    assert.equal(isTeamChatWorkflow([start({ triggerType: 'chatWidget', accessMode: 'public' })], 'team'), false)
    for (const t of ['pstn', 'telegram', 'schedule', 'subworkflow']) {
      assert.equal(isTeamChatWorkflow([start({ triggerType: t, accessMode: 'team' })], 'team'), false, t)
    }
  })

  it('excluded if there is no start node or nodes is not an array', () => {
    assert.equal(isTeamChatWorkflow([], 'team'), false)
    assert.equal(isTeamChatWorkflow(undefined, 'team'), false)
    assert.equal(isTeamChatWorkflow([{ id: 'a', data: { nodeType: 'ai', accessMode: 'team' } }], 'team'), false)
  })
})

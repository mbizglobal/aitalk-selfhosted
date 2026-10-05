
import { canReadTemplatePath } from './template-scope'

const MAX_LENGTH = 2000
const MAX_DEPTH = 32

const ALLOWED_METHODS = new Set(['includes', 'startsWith', 'endsWith'])

class ExpressionError extends Error {}

function relational(a: any, b: any, op: '>' | '<' | '>=' | '<='): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b
  }
  const x = Number(a)
  const y = Number(b)
  return op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : x <= y
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'kw'; v: 'true' | 'false' | 'null' }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }

// ========================================
// ========================================

const OPERATORS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '!', '-', '(', ')', '.', '[', ']', ',']

const IDENT_START = /^[\p{L}\p{Nl}_$]$/u
const IDENT_PART = /^[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}_$]$/u

function codePointAt(src: string, i: number): string {
  if (i >= src.length) return ''
  const cp = src.codePointAt(i)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0

  while (i < src.length) {
    const c = src[i]

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }

    if (c === '"' || c === "'") {
      const quote = c
      let v = ''
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] !== '\\') { v += src[i]; i++; continue }

        const next = src[i + 1]
        i += 2
        switch (next) {
          case 'n': v += '\n'; break
          case 'r': v += '\r'; break
          case 't': v += '\t'; break
          case 'b': v += '\b'; break
          case 'f': v += '\f'; break
          case 'v': v += '\v'; break
          case '0': v += '\0'; break
          case '\\': v += '\\'; break
          case "'": v += "'"; break
          case '"': v += '"'; break
          case 'x': {
            const hex = src.slice(i, i + 2)
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new ExpressionError('\\x 이스케이프가 올바르지 않다')
            v += String.fromCharCode(parseInt(hex, 16))
            i += 2
            break
          }
          case 'u': {
            if (src[i] === '{') {
              const end = src.indexOf('}', i)
              const hex = end === -1 ? '' : src.slice(i + 1, end)
              if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) throw new ExpressionError('\\u{...} 이스케이프가 올바르지 않다')
              v += String.fromCodePoint(parseInt(hex, 16))
              i = end + 1
            } else {
              const hex = src.slice(i, i + 4)
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ExpressionError('\\u 이스케이프가 올바르지 않다')
              v += String.fromCharCode(parseInt(hex, 16))
              i += 4
            }
            break
          }
          default:
            throw new ExpressionError(`지원하지 않는 이스케이프: \\${next ?? '(끝)'}`)
        }
      }
      if (i >= src.length) throw new ExpressionError('닫히지 않은 문자열')
      i++
      out.push({ t: 'str', v })
      continue
    }

    if (c >= '0' && c <= '9') {
      let j = i
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const raw = src.slice(i, j)
      const v = Number(raw)
      if (!Number.isFinite(v)) throw new ExpressionError(`숫자가 아니다: ${raw}`)
      out.push({ t: 'num', v })
      i = j
      continue
    }

    if (IDENT_START.test(codePointAt(src, i))) {
      let j = i
      for (;;) {
        const ch = codePointAt(src, j)
        if (!ch || !IDENT_PART.test(ch)) break
        j += ch.length
      }
      const v = src.slice(i, j)
      if (v === 'true' || v === 'false' || v === 'null') out.push({ t: 'kw', v })
      else out.push({ t: 'ident', v })
      i = j
      continue
    }

    const op = OPERATORS.find(o => src.startsWith(o, i))
    if (op) {
      out.push({ t: 'op', v: op })
      i += op.length
      continue
    }

    throw new ExpressionError(`허용되지 않은 문자: ${JSON.stringify(c)}`)
  }

  return out
}

// ========================================
// ========================================

class Evaluator {
  private pos = 0
  private depth = 0
  private skipping = 0

  constructor(
    private readonly tokens: Token[],
    private readonly context: Record<string, any>,
    checkOnly = false,
  ) {
    if (checkOnly) this.skipping = 1
  }

  private peek(): Token | undefined { return this.tokens[this.pos] }

  private eatOp(v: string): boolean {
    const t = this.peek()
    if (t && t.t === 'op' && t.v === v) { this.pos++; return true }
    return false
  }

  private expectOp(v: string): void {
    if (!this.eatOp(v)) throw new ExpressionError(`'${v}' 가 필요하다`)
  }

  run(): boolean {
    const value = this.parseOr()
    if (this.pos !== this.tokens.length) throw new ExpressionError('표현식 뒤에 남은 토큰이 있다')
    return Boolean(value)
  }

  private parseOr(): any {
    let left = this.parseAnd()
    while (this.eatOp('||')) {
      if (left) {
        this.skipping++
        try { this.parseAnd() } finally { this.skipping-- }
      } else {
        left = this.parseAnd()
      }
    }
    return left
  }

  private parseAnd(): any {
    let left = this.parseEquality()
    while (this.eatOp('&&')) {
      if (!left) {
        this.skipping++
        try { this.parseEquality() } finally { this.skipping-- }
      } else {
        left = this.parseEquality()
      }
    }
    return left
  }

  private parseEquality(): any {
    let left = this.parseRelational()
    for (;;) {
      if (this.eatOp('===')) { left = left === this.parseRelational(); continue }
      if (this.eatOp('!==')) { left = left !== this.parseRelational(); continue }
      if (this.eatOp('==')) { left = left == this.parseRelational(); continue }   // eslint-disable-line eqeqeq
      if (this.eatOp('!=')) { left = left != this.parseRelational(); continue }   // eslint-disable-line eqeqeq
      return left
    }
  }

  private parseRelational(): any {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (!t || t.t !== 'op') return left
      if (t.v === '>' || t.v === '<' || t.v === '>=' || t.v === '<=') {
        this.pos++
        left = relational(left, this.parseUnary(), t.v)
        continue
      }
      return left
    }
  }

  private parseUnary(): any {
    if (this.eatOp('!')) return !this.parseUnary()
    if (this.eatOp('-')) return -Number(this.parseUnary())
    return this.parsePrimary()
  }

  private parsePrimary(): any {
    if (this.depth++ > MAX_DEPTH) throw new ExpressionError('중첩이 너무 깊다')
    try {
      if (this.eatOp('(')) {
        const v = this.parseOr()
        this.expectOp(')')
        return v
      }

      const t = this.peek()
      if (!t) throw new ExpressionError('표현식이 갑자기 끝났다')

      if (t.t === 'num' || t.t === 'str') { this.pos++; return t.v }
      if (t.t === 'kw') {
        this.pos++
        return t.v === 'true' ? true : t.v === 'false' ? false : null
      }
      if (t.t === 'ident') return this.parsePathAndCall()

      throw new ExpressionError(`예상치 못한 토큰: ${JSON.stringify(t)}`)
    } finally {
      this.depth--
    }
  }

  private parsePathAndCall(): any {
    const segments: string[] = []
    const head = this.peek()
    if (!head || head.t !== 'ident') throw new ExpressionError('경로가 아니다')
    segments.push(head.v)
    this.pos++

    let method: string | null = null

    for (;;) {
      if (this.eatOp('.')) {
        const next = this.peek()
        if (!next || next.t !== 'ident') throw new ExpressionError("'.' 뒤에는 이름이 와야 한다")
        this.pos++
        if (this.peek()?.t === 'op' && (this.peek() as any).v === '(') {
          if (!ALLOWED_METHODS.has(next.v)) {
            throw new ExpressionError(`허용되지 않은 메서드: ${next.v}`)
          }
          method = next.v
          break
        }
        segments.push(next.v)
        continue
      }
      if (this.eatOp('[')) {
        const idx = this.peek()
        if (!idx || idx.t !== 'num' || !Number.isInteger(idx.v) || idx.v < 0) {
          throw new ExpressionError('배열 인덱스는 0 이상 정수여야 한다')
        }
        this.pos++
        this.expectOp(']')
        segments.push(String(idx.v))
        continue
      }
      break
    }

    const value = this.readPath(segments)

    if (method) {
      this.expectOp('(')
      const arg = this.peek()
      if (!arg || (arg.t !== 'str' && arg.t !== 'num')) {
        throw new ExpressionError(`${method}() 인자는 리터럴이어야 한다`)
      }
      this.pos++
      this.expectOp(')')

      const s = value === null || value === undefined ? '' : String(value)
      const needle = String(arg.v)
      return method === 'includes' ? s.includes(needle)
        : method === 'startsWith' ? s.startsWith(needle)
        : s.endsWith(needle)
    }

    return value
  }

  private readPath(segments: string[]): any {
    if (this.skipping > 0) return undefined

    const parts = segments[0] === 'context' && segments.length > 1 ? segments.slice(1) : segments
    const path = parts.join('.')

    if (!canReadTemplatePath(this.context, path)) {
      throw new ExpressionError(`허용되지 않은 컨텍스트 경로: ${path}`)
    }

    let current: any = this.context
    for (const p of parts) {
      if (current === null || current === undefined) return undefined
      current = current[p]
    }

    if (typeof current === 'function') {
      throw new ExpressionError(`함수는 값으로 쓸 수 없다: ${path}`)
    }
    return current
  }
}

export function evaluateSafeExpression(expression: string, context: Record<string, any>): boolean {
  if (typeof expression !== 'string') return false
  const src = expression.trim()
  if (!src) return false

  if (src.length > MAX_LENGTH) {
    console.error(`[Condition] 조건식이 너무 길다 (${src.length} > ${MAX_LENGTH}) — false 로 평가한다`)
    return false
  }

  try {
    return new Evaluator(tokenize(src), context).run()
  } catch (error) {
    const reason = error instanceof ExpressionError ? error.message : String(error)
    console.error(`[Condition] 조건식을 평가할 수 없다: ${reason} — false 로 평가한다\n  식: ${src.slice(0, 200)}`)
    return false
  }
}

const SYNTAX_HELP =
  'it is not a valid Code mode expression. Supported: comparisons (== != === !== > < >= <=), ' +
  '&& || !, parentheses, number/string/true/false/null literals, a unary - that coerces what ' +
  'follows to a number (so -0.5, -path.to.n and -(x) all work), dotted paths with [0] array ' +
  'indexes, and .includes()/.startsWith()/.endsWith() with a single literal argument. ' +
  'Not supported: the ternary "? :", binary arithmetic (+ - * /), typeof/in/instanceof, ' +
  'bracket string keys like a["b"], and any other method call'

export function checkSafeExpressionSyntax(expression: unknown): string | null {
  if (expression === undefined || expression === null) return 'the expression is missing'
  if (typeof expression !== 'string') {
    return `the expression must be a string (got ${Array.isArray(expression) ? 'array' : typeof expression})`
  }

  const src = expression.trim()
  if (!src) return 'the expression is empty'
  if (src.length > MAX_LENGTH) return `the expression is too long (${src.length} > ${MAX_LENGTH} characters)`

  try {
    new Evaluator(tokenize(src), {}, true).run()
    return null
  } catch (error) {
    if (error instanceof ExpressionError) return SYNTAX_HELP
    return `the expression could not be checked: ${String(error)}`
  }
}

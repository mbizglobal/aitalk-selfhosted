
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { toSafeUrl, SAFE_LINK_PROTOCOLS, SAFE_IMAGE_PROTOCOLS } from './safe-url'

const link = (u: string) => toSafeUrl(u, SAFE_LINK_PROTOCOLS)
const image = (u: string) => toSafeUrl(u, SAFE_IMAGE_PROTOCOLS)

describe('toSafeUrl: what must pass (no over-blocking)', () => {
  it('http/https pass for both links and images', () => {
    for (const u of ['https://example.com/a.png', 'http://example.com', 'https://x/y?a=1#f']) {
      assert.ok(link(u), `링크: ${u}`)
      assert.ok(image(u), `이미지: ${u}`)
    }
  })

  it('RED: mailto and tel pass for links: the widget (react-markdown) allows them, so they really arrive', () => {
    assert.equal(link('mailto:support@example.com'), 'mailto:support@example.com')
    assert.equal(link('tel:+41791234567'), 'tel:+41791234567')
  })

  it('mailto and tel are rejected for images: an image makes a real request', () => {
    assert.equal(image('mailto:support@example.com'), null)
    assert.equal(image('tel:+41791234567'), null)
  })
})

describe('toSafeUrl: what must be rejected', () => {
  it('rejects script-execution schemes', () => {
    for (const u of ['javascript:alert(1)', 'vbscript:msgbox', 'data:text/html,<script>x</script>']) {
      assert.equal(link(u), null, u)
      assert.equal(image(u), null, u)
    }
  })

  it('rejects local-resource schemes', () => {
    for (const u of ['file:///etc/passwd', 'chrome://settings']) {
      assert.equal(link(u), null, u)
    }
  })

  it('rejects relative paths and protocol-relative URLs: on the dashboard they wrongly resolve to our domain', () => {
    for (const u of ['/booking', './x', '../x', '//evil.example/x', 'not a url']) {
      assert.equal(link(u), null, u)
    }
  })

  it('rejects empty values', () => {
    for (const u of ['', '   ']) {
      assert.equal(link(u), null, JSON.stringify(u))
    }
  })
})

describe('RED toSafeUrl: bypass variants (this is the value of this file)', () => {
  it('is not bypassed by case variants', () => {
    for (const u of ['JaVaScRiPt:alert(1)', 'JAVASCRIPT:alert(1)', 'Data:text/html,x']) {
      assert.equal(link(u), null, u)
    }
  })

  it('is not bypassed by leading or trailing whitespace', () => {
    for (const u of ['  javascript:alert(1)', 'javascript:alert(1)   ', '\tjavascript:alert(1)']) {
      assert.equal(link(u), null, JSON.stringify(u))
    }
  })

  it('RED: is not bypassed by a tab or newline inside the scheme: the browser strips it and executes', () => {
    for (const u of ['java\nscript:alert(1)', 'java\tscript:alert(1)', 'java\rscript:alert(1)']) {
      assert.equal(link(u), null, JSON.stringify(u))
    }
  })

  it('RED: a passing value is the "normalized copy": returning the original as is would revive the tab/newline variants above', () => {
    const out = link('https://example.com/\tpath')
    assert.ok(out, '정상 http 는 통과해야 한다')
    assert.equal(/[\t\n\r]/.test(out!), false, `정규화본이어야 한다: ${JSON.stringify(out)}`)
  })
})

describe('contract of the allowlists themselves', () => {
  it('the image allowlist is a subset of the link allowlist', () => {
    for (const p of SAFE_IMAGE_PROTOCOLS) {
      assert.ok(SAFE_LINK_PROTOCOLS.has(p), `${p} 가 링크 목록에 없다`)
    }
  })

  it('the allowlists do not contain script-execution schemes', () => {
    for (const bad of ['javascript:', 'data:', 'vbscript:', 'file:']) {
      assert.equal(SAFE_LINK_PROTOCOLS.has(bad), false, `${bad} 가 허용목록에 있다`)
      assert.equal(SAFE_IMAGE_PROTOCOLS.has(bad), false, `${bad} 가 허용목록에 있다`)
    }
  })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebPageError, WEB_PAGE_MAX_CHARS, normalizePageUrl, pageToText, parsePageUrl, urlWasGiven, urlsInText } from './web-page'

const codeOf = (f: () => unknown) => { try { f(); return 'ok' } catch (e) { return e instanceof WebPageError ? e.code : 'other' } }

test('address check - empty, not text, ftp, user/password = INVALID_URL - ports other than 80/443 = BLOCKED_ADDRESS', () => {
  for (const bad of [undefined, null, '', '  ', 42, 'not a url', 'ftp://x.ch/a', 'javascript:alert(1)', 'https://user:pw@x.ch/', 'https://user@x.ch/']) {
    assert.equal(codeOf(() => parsePageUrl(bad)), 'INVALID_URL', String(bad))
  }
  assert.equal(codeOf(() => parsePageUrl('https://x.ch:8443/')), 'BLOCKED_ADDRESS')
  assert.equal(codeOf(() => parsePageUrl('http://x.ch:80/a')), 'ok')
  assert.equal(codeOf(() => parsePageUrl(' https://x.ch/a ')), 'ok')
})

test('standard shape - scheme, lowercase host, default port, empty path, #fragment', () => {
  assert.equal(normalizePageUrl('HTTPS://WWW.Example.COM:443#top'), 'https://www.example.com/')
  assert.equal(normalizePageUrl('https://example.com/a?b=1#x'), 'https://example.com/a?b=1')
  assert.equal(normalizePageUrl('nope'), null)
})

test('extracting addresses from human text - trailing punctuation, unmatched brackets, www, markdown angle brackets', () => {
  assert.deepEqual(urlsInText('이 페이지 봐 줘: https://x.ch/pricing.'), ['https://x.ch/pricing'])
  assert.deepEqual(urlsInText('(https://x.ch/a) 와 <https://y.ch/b>'), ['https://x.ch/a', 'https://y.ch/b'])
  assert.deepEqual(urlsInText('https://en.wikipedia.org/wiki/Bern_(Switzerland) 참고'), ['https://en.wikipedia.org/wiki/Bern_(Switzerland)'])
  assert.deepEqual(urlsInText('www.x.ch/a?b=1!'), ['https://www.x.ch/a?b=1'])
  assert.deepEqual(urlsInText('주소 없음'), [])
})

test('is it an address the person gave - must match in standard shape - other path or host = no', () => {
  const said = ['가격은 HTTPS://www.X.ch/en/pricing#plans 에 있어']
  assert.equal(urlWasGiven(new URL('https://www.x.ch/en/pricing'), said), true)
  assert.equal(urlWasGiven(new URL('https://www.x.ch/en/pricing?leak=secret'), said), false)
  assert.equal(urlWasGiven(new URL('https://evil.example/en/pricing'), said), false)
  assert.equal(urlWasGiven(new URL('https://www.x.ch/en/pricing'), []), false)
})

test('HTML to text - script and style dropped - title - main when large enough, otherwise body', () => {
  const long = 'Standard € 100 per month. '.repeat(10)
  const html = `<html><head><title> Pricing  page </title><style>.a{}</style></head><body><nav>Menu</nav><main><h1>Plans</h1><p>${long}</p><script>alert(1)</script></main></body></html>`
  const r = pageToText(Buffer.from(html), 'text/html; charset=utf-8')
  assert.equal(r.title, 'Pricing page')
  assert.ok(r.text.startsWith('# Plans') && r.text.includes('€ 100') && !r.text.includes('alert') && !r.text.includes('Menu'), r.text)
  const short = pageToText(Buffer.from('<body><nav>Menu</nav><main>tiny</main><p>Footer v1.0.1</p></body>'), 'text/html')
  assert.ok(short.text.includes('Menu') && short.text.includes('v1.0.1'), short.text)
})

test('encoding - header charset, meta charset, UTF-16 BOM, unknown names = UTF-8', () => {
  const latin = Buffer.from('<body><p>Zürich Grösse</p></body>', 'latin1')
  assert.ok(pageToText(latin, 'text/html; charset=ISO-8859-1').text.includes('Zürich Grösse'))
  assert.ok(pageToText(Buffer.concat([Buffer.from('<meta charset="iso-8859-1">'), latin]), 'text/html').text.includes('Zürich'))
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<body><p>Bern 8000</p></body>', 'utf16le')])
  assert.ok(pageToText(u16, 'text/html').text.includes('Bern 8000'))
  assert.ok(pageToText(Buffer.from('<body>ok</body>'), 'text/html; charset=no-such-charset').text.includes('ok'))
})

test('text kinds, empty text, cutting - xhtml = HTML - json and plain unchanged - empty = EMPTY_PAGE - 20000 characters', () => {
  assert.equal(pageToText(Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x1</p></body></html>'), 'application/xhtml+xml').text, 'x1')
  assert.equal(pageToText(Buffer.from('{"tag_name":"v1.0.1"}'), 'application/json').text, '{"tag_name":"v1.0.1"}')
  assert.equal(codeOf(() => pageToText(Buffer.from('<html><body><div id="app"></div><script>x()</script></body></html>'), 'text/html')), 'EMPTY_PAGE')
  assert.equal(codeOf(() => pageToText(Buffer.from('   \n '), 'text/plain')), 'EMPTY_PAGE')
  const big = pageToText(Buffer.from('a'.repeat(WEB_PAGE_MAX_CHARS + 50)), 'text/plain')
  assert.equal(big.truncated, true)
  assert.equal(big.text.length, WEB_PAGE_MAX_CHARS)
})

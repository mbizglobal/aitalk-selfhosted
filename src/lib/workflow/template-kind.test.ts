import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterTemplatesByKind, parseTemplateListKind } from './template-kind'

const app = { id: 'app', workflowJson: { nodes: [{ id: 's', type: 'custom', data: { nodeType: 'start', triggerType: 'app' } }, { id: 'a', data: { nodeType: 'workApp' } }], edges: [] } }
const voice = { id: 'voice', workflowJson: { nodes: [{ id: 's', type: 'custom', data: { nodeType: 'start', triggerType: 'pstn' } }], edges: [] } }
const empty = { id: 'empty', workflowJson: {} }
const vat = { id: 'vat', workflowJson: { nodes: [{ id: 's', data: { nodeType: 'start', triggerType: 'app' } }, { id: 'a', data: { nodeType: 'workApp', appTemplate: 'vat' } }], edges: [] } }
const list = [app, voice, empty]

describe('splitting templates - Work App field - From Template', () => {
  it('query value', () => {
    assert.equal(parseTemplateListKind(null), null)
    assert.equal(parseTemplateListKind('workApp'), 'workApp')
    assert.equal(parseTemplateListKind('workflow'), 'workflow')
    assert.equal(parseTemplateListKind(''), 'invalid')
    assert.equal(parseTemplateListKind('workapp'), 'invalid')
  })
  it('none = everything unchanged', () => assert.deepEqual(filterTemplatesByKind(list, null).map((x) => x.id), ['app', 'voice', 'empty']))
  it('workApp = Start(App) bodies only', () => assert.deepEqual(filterTemplatesByKind(list, 'workApp').map((x) => x.id), ['app']))
  it('workflow = the rest (including readable bodies without nodes)', () => assert.deepEqual(filterTemplatesByKind(list, 'workflow').map((x) => x.id), ['voice', 'empty']))
  it('patterns are hidden when their fixed app template is not on this install', () => {
    assert.deepEqual(filterTemplatesByKind([app, vat], 'workApp', (k) => k === 'vat').map((x) => x.id), ['app', 'vat'])
    assert.deepEqual(filterTemplatesByKind([app, vat], 'workApp', () => false).map((x) => x.id), ['app'])
    assert.deepEqual(filterTemplatesByKind([app, vat], null, () => false).map((x) => x.id), ['app', 'vat'])
  })
})

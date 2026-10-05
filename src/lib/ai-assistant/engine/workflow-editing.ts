
import { prisma } from '@/lib/prisma';
import {
  saveMessage,
  buildHierarchicalMessages,
  checkAndSummarize,
} from '../session-service';
import { applyModificationsToWorkflow, replaceWorkflowJson } from '../workflow-modifier';
import { detectContextsFromWorkflow } from '@/lib/codex-lib/context-instructions';
import { buildCodexContext, generateCodexPrompt } from '@/lib/codex-lib';
import { t } from './messages';
import type { LangCode } from '../intent-classifier';
import type { EngineRequest, EngineResponse } from './types';
import type { ContextBuilder } from '../context-builder';
import type { ResponseParser } from '../response-parser';

const EDIT_KEYWORDS = new RegExp([
  // ko
  '변경', '바꾸', '수정', '설정', '추가', '삭제', '제거', '편집',
  '업데이트', '고치', '넣', '빼', '지우', '교체', '대체', '치환',
  // en
  'update', 'modify', 'change', 'set', 'add', 'remove', 'delete', 'replace',
  'edit', 'fix', 'swap', 'switch', 'rename', 'insert', 'move', 'convert',
  'rewrite', 'adjust', 'configure', 'alter', 'transform', 'overwrite',
  // de
  'änder', 'bearbeit', 'lösch', 'entfern', 'hinzufüg', 'ersetz',
  'einstell', 'tausch', 'wechsel', 'umwandel', 'umbenenn', 'anpass',
  // fr
  'changer', 'supprimer', 'ajouter', 'remplacer', 'éditer', 'modifier',
  'configurer', 'convertir', 'renommer', 'insérer', 'ajuster',
  // es
  'editar', 'eliminar', 'borrar', 'añadir', 'agregar', 'sustituir',
  'cambiar', 'configurar', 'convertir', 'renombrar', 'insertar', 'ajustar',
].join('|'), 'i');

export function isWorkflowEditingRequest(input: string): boolean {
  const normalized = input.toLowerCase().trim();

  if (!EDIT_KEYWORDS.test(normalized)) return false;

  const nodeOrFieldPatterns = /system\s*message|시스템\s*메시지|systemnachricht|message\s*syst[eè]me|mensaje\s*del?\s*sistema|temperature|온도|temperatur|température|temperatura|model|모델|modell|modèle|modelo|provider|프로바이더|anbieter|fournisseur|proveedor|tool|도구|werkzeug|outil|herramienta|header|헤더|body|본문|condition|조건|bedingung|message|메시지|nachricht|url|method|max\s*token|노드|node|knoten|nœud|nodo|prompt|프롬프트/;
  return nodeOrFieldPatterns.test(normalized);
}

export function isEditingExit(input: string): boolean {
  const normalized = input.toLowerCase().trim().replace(/[!?.,~]+$/g, '');
  return /^(완료|끝|종료|끝내기|편집 완료|편집 종료|done|finish|finished|exit|quit|complete|fertig|beenden|abgeschlossen|schließen|fini|terminé|quitter|arrêter|sortir|terminado|salir|cerrar|finalizar|acabar|completado)$/i.test(normalized);
}

export function isViewStructureRequest(input: string): boolean {
  const normalized = input.toLowerCase().trim();

  if (EDIT_KEYWORDS.test(normalized)) return false;

  const contentKeywords = /원본|텍스트|내용|원문|전문|생략|text|content|full.*text|prompt|system\s*message|inhalt|volltext|contenu|texte|contenido|texto/;
  if (contentKeywords.test(normalized)) return false;

  const nodeTypes = 'ai|start|end|trigger|source|mcp|sendgrid|telegram|imap|smtp|http|store|ifelse|while|wait|schedule|condition';
  const nodeDescWords = '노드|node|knoten|nœud|nodo|세팅|setting|config|설명|explain|detail|erkläre?|expliquer|explicar|파라미터|parameter|메시지|message|nachricht|모델|model|temperature';
  const specificNodeKeywords = new RegExp(`\\b(${nodeTypes})\\b.*\\b(${nodeDescWords})\\b`);
  const specificNodeKeywordsReversed = new RegExp(`\\b(${nodeDescWords})\\b.*\\b(${nodeTypes})\\b`);
  if (specificNodeKeywords.test(normalized) || specificNodeKeywordsReversed.test(normalized)) return false;

  const viewKeywords = new RegExp([
    // ko
    '구조', '분석', '전체.*보여', '보여.*전체', '전체.*알려', '알려.*전체',
    '노드.*목록', '목록.*노드', '워크플로우.*보여', '보여.*워크플로우',
    '워크플로우.*알려', '알려.*워크플로우',
    // en
    'structure', 'overview', 'analy[sz]e',
    'show.*workflow', 'workflow.*show',
    'list.*node', 'node.*list',
    'describe.*workflow', 'workflow.*describe',
    // de
    'struktur', 'übersicht', 'analysieren',
    'zeig.*workflow', 'workflow.*zeig', 'knoten.*auflisten',
    // fr
    'aperçu', 'analyser', 'vue.*d.ensemble',
    'montrer.*workflow', 'lister.*nœud',
    // es
    'estructura', 'resumen', 'analizar',
    'mostrar.*workflow', 'listar.*nodo',
  ].join('|'));
  return viewKeywords.test(normalized);
}

const NODE_TYPE_LABELS: Record<string, string> = {
  start: 'Trigger', schedule: 'Schedule', ai: 'AI',
  end: 'End', ifElse: 'If/Else', while: 'Loop',
  wait: 'Wait', continue: 'Continue',
  source: 'RAG Source', store: 'RAG Store', mcp: 'MCP',
  webSearch: 'Web Search', functionCalling: 'Function Calling',
  dataSheets: 'Data Sheets', httpRequest: 'HTTP Request',
  sendgrid: 'SendGrid', telegram: 'Telegram',
  imap: 'IMAP', smtp: 'SMTP', note: 'Note',
};

function resolveSemanticType(node: any): string {
  if (node.type === 'tool' && node.data?.toolType) return node.data.toolType;
  if (node.type === 'custom' && node.data?.nodeType) return node.data.nodeType;
  if (node.data?.nodeType) return node.data.nodeType;
  return node.type || 'unknown';
}

export function buildWorkflowSummary(
  workflowName: string,
  nodes: any[],
  edges: any[]
): string {
  const lines: string[] = [];

  lines.push(`📋 **Workflow: ${workflowName}**`);
  lines.push('');

  // --- Nodes ---
  const mainNodes = nodes.filter((n: any) => {
    const st = resolveSemanticType(n);
    if (st === 'note') return false;
    return true;
  });
  const toolNodes = nodes.filter((n: any) => n.type === 'tool');
  const flowNodes = mainNodes.filter((n: any) => n.type !== 'tool');

  lines.push(`📍 **Nodes (${flowNodes.length}개):**`);

  for (let i = 0; i < flowNodes.length; i++) {
    const node = flowNodes[i];
    const semanticType = resolveSemanticType(node);
    const typeLabel = NODE_TYPE_LABELS[semanticType] || semanticType;
    const label = node.data?.label || node.id;
    let detail = `${i + 1}. [${typeLabel}] ${label}`;

    if (semanticType === 'ai') {
      const parts: string[] = [];
      if (node.data?.provider) parts.push(node.data.provider);
      if (node.data?.model) parts.push(node.data.model);
      if (node.data?.temperature != null) parts.push(`temp: ${node.data.temperature}`);
      if (node.data?.maxTokens) parts.push(`maxTokens: ${node.data.maxTokens}`);
      if (parts.length) detail += ` - ${parts.join(', ')}`;
      if (node.data?.systemMessage) {
        const sm = node.data.systemMessage.length > 500
          ? node.data.systemMessage.slice(0, 500) + '...'
          : node.data.systemMessage;
        detail += `\n   System: "${sm}"`;
        if (node.data.systemMessage.length > 500) {
          detail += `\n   → 전체 보기: "AI 노드 systemMessage 보여줘"`;
        }
      }
      // Tools
      const tools = node.data?.selectedTools;
      if (tools) {
        const enabled = Object.entries(tools)
          .filter(([, v]) => v === true)
          .map(([k]) => k);
        if (enabled.length) detail += `\n   Tools: ${enabled.join(', ')}`;
      }
      const childTools = toolNodes.filter((t: any) => t.data?.parentId === node.id);
      for (const t of childTools) {
        const tType = t.data?.toolType || 'tool';
        const tLabel = NODE_TYPE_LABELS[tType] || tType;
        detail += `\n   └ [${tLabel}] ${t.data?.label || t.id}`;
      }
    }

    if (semanticType === 'start' && node.data?.accessMode) {
      detail += ` (${node.data.accessMode})`;
    }

    if (semanticType === 'end' && node.data?.message) {
      const msg = node.data.message.length > 60
        ? node.data.message.slice(0, 60) + '...'
        : node.data.message;
      detail += ` - "${msg}"`;
      if (node.data.message.length > 60) {
        detail += `\n   → 전체 보기: "${typeLabel} 노드 message 보여줘"`;
      }
    }

    if (semanticType === 'ifElse' && node.data?.conditions?.length) {
      detail += ` (${node.data.conditions.length} conditions)`;
    }

    if (semanticType === 'while' && node.data?.maxIterations) {
      detail += ` (max ${node.data.maxIterations} iterations)`;
    }

    if (semanticType === 'httpRequest' && node.data?.url) {
      detail += ` - ${node.data.method || 'GET'} ${node.data.url}`;
    }

    if (semanticType === 'dataSheets' && node.data?.operation) {
      detail += ` - ${node.data.operation}`;
    }

    if (semanticType === 'wait' && node.data?.message) {
      const msg = node.data.message.length > 60
        ? node.data.message.slice(0, 60) + '...'
        : node.data.message;
      detail += ` - "${msg}"`;
      if (node.data.message.length > 60) {
        detail += `\n   → 전체 보기: "${typeLabel} 노드 message 보여줘"`;
      }
    }

    lines.push(detail);
  }

  const flowEdges = edges.filter((e: any) => e.sourceHandle !== 'tools');
  if (flowEdges.length > 0) {
    lines.push('');
    lines.push(`🔗 **Connections:**`);

    const nodeMap = new Map<string, string>();
    for (const n of nodes) {
      nodeMap.set(n.id, n.data?.label || n.id);
    }

    for (const edge of flowEdges) {
      const src = nodeMap.get(edge.source) || edge.source;
      const tgt = nodeMap.get(edge.target) || edge.target;
      const handle = edge.sourceHandle && edge.sourceHandle !== 'default'
        ? ` [${edge.sourceHandle}]`
        : '';
      lines.push(`${src}${handle} → ${tgt}`);
    }
  }

  return lines.join('\n');
}

export function buildNodeDetailIfRequested(
  input: string,
  nodes: any[],
): string | null {
  const normalized = input.toLowerCase().trim();

  if (/변경|바꿔|수정|설정|추가|삭제|제거|개선|업데이트|교체|replace|improve|change|set to|update|modify|add|remove|delete/i.test(normalized)) {
    return null;
  }

  const viewPattern = /보여|전체|내용|원본|원문|상세|정보|알려|show|full|content|detail|info|config|display/;
  if (!viewPattern.test(normalized)) return null;

  const fieldMatch = detectFieldRequest(normalized);

  let matchedNode = findNodeByInput(normalized, nodes);

  if (!matchedNode && fieldMatch) {
    matchedNode = findNodeByField(fieldMatch, nodes);
  }

  if (!matchedNode) {
    const mainNodes = nodes.filter(n => {
      const st = resolveSemanticType(n);
      return st !== 'start' && st !== 'end' && st !== 'note' && n.type !== 'tool';
    });
    if (mainNodes.length === 1) matchedNode = mainNodes[0];
  }

  if (!matchedNode) return null;

  return formatNodeDetail(matchedNode, fieldMatch);
}

const FIELD_NODE_TYPE_MAP: Record<string, string[]> = {
  systemMessage: ['ai'],
  temperature: ['ai'],
  maxTokens: ['ai'],
  selectedTools: ['ai'],
  outputFormat: ['ai'],
  includeChatHistory: ['ai'],
  url: ['httpRequest'],
  method: ['httpRequest'],
  headers: ['httpRequest'],
  body: ['httpRequest'],
  conditions: ['ifElse'],
  maxIterations: ['while'],
  accessMode: ['start'],
  parseMode: ['start', 'telegram'],
  triggerType: ['start'],
};

function findNodeByField(fieldName: string, nodes: any[]): any | null {
  const nodeTypes = FIELD_NODE_TYPE_MAP[fieldName];
  if (nodeTypes) {
    const candidates = nodes.filter(n => {
      const st = resolveSemanticType(n);
      return nodeTypes.includes(st) && n.data?.[fieldName] != null;
    });
    if (candidates.length === 1) return candidates[0];
  }
  const candidates = nodes.filter(n => n.data?.[fieldName] != null);
  if (candidates.length === 1) return candidates[0];
  return null;
}

function findNodeByInput(input: string, nodes: any[]): any | null {
  const typeAliases: Record<string, string[]> = {
    ai: ['ai', 'ai노드', 'ai node'],
    start: ['start', 'trigger', '트리거', '시작'],
    end: ['end', '종료', '끝'],
    ifElse: ['if', 'ifelse', 'if/else', '조건', 'condition'],
    while: ['while', 'loop', '루프', '반복'],
    wait: ['wait', '대기'],
    source: ['source', 'rag source', '소스'],
    store: ['store', 'rag store', '스토어'],
    mcp: ['mcp'],
    dataSheets: ['datasheet', 'data sheet', '데이터시트'],
    httpRequest: ['http', 'http request', 'api'],
    sendgrid: ['sendgrid', '센드그리드'],
    telegram: ['telegram', '텔레그램'],
    imap: ['imap'],
    smtp: ['smtp'],
    schedule: ['schedule', '스케줄'],
  };

  for (const node of nodes) {
    const semanticType = resolveSemanticType(node);
    const aliases = typeAliases[semanticType] || [semanticType];

    for (const alias of aliases) {
      if (input.includes(alias)) return node;
    }

    const label = (node.data?.label || '').toLowerCase();
    if (label && label.length > 2 && input.includes(label)) return node;
  }

  return null;
}

function detectFieldRequest(input: string): string | null {
  if (/system\s*message|시스템\s*메시지|시스템\s*프롬프트|system\s*prompt/.test(input)) return 'systemMessage';
  if (/temperature|온도/.test(input)) return 'temperature';
  if (/model|모델/.test(input)) return 'model';
  if (/provider|프로바이더/.test(input)) return 'provider';
  if (/tool|도구/.test(input)) return 'selectedTools';
  if (/header|헤더/.test(input)) return 'headers';
  if (/body|바디|본문/.test(input)) return 'body';
  if (/condition|조건/.test(input)) return 'conditions';
  if (/message|메시지/.test(input)) return 'message';
  if (/url/.test(input)) return 'url';
  return null;
}

function formatNodeDetail(node: any, fieldName: string | null): string {
  const semanticType = resolveSemanticType(node);
  const typeLabel = NODE_TYPE_LABELS[semanticType] || semanticType;
  const label = node.data?.label || node.id;
  const data = node.data || {};

  if (fieldName) {
    const value = data[fieldName];
    if (value == null) {
      return `[${typeLabel}] ${label} — \`${fieldName}\` 필드가 설정되어 있지 않습니다.`;
    }
    if (typeof value === 'string') {
      return `**[${typeLabel}] ${label}** — \`${fieldName}\` (${value.length}자):\n\n${value}`;
    }
    const json = JSON.stringify(value, null, 2);
    return `**[${typeLabel}] ${label}** — \`${fieldName}\` (${json.length}자):\n\n\`\`\`json\n${json}\n\`\`\``;
  }

  const lines: string[] = [];
  lines.push(`**[${typeLabel}] ${label}** (id: ${node.id})`);
  lines.push('');

  const priorityFields = ['provider', 'model', 'temperature', 'maxTokens', 'systemMessage', 'message', 'accessMode', 'url', 'method'];
  const shown = new Set<string>();

  for (const field of priorityFields) {
    if (data[field] != null) {
      shown.add(field);
      const val = data[field];
      if (typeof val === 'string' && val.length > 100) {
        lines.push(`**${field}**:\n${val}`);
      } else if (typeof val === 'object') {
        const json = JSON.stringify(val, null, 2);
        lines.push(`**${field}**:\n\`\`\`json\n${json}\n\`\`\``);
      } else {
        lines.push(`**${field}**: ${val}`);
      }
    }
  }

  if (data.selectedTools) {
    shown.add('selectedTools');
    const enabled = Object.entries(data.selectedTools)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    if (enabled.length) lines.push(`**tools**: ${enabled.join(', ')}`);
  }

  const skipFields = new Set(['label', 'icon', 'color', 'nodeType', 'toolType', 'showLeftHandle', 'showRightHandle', 'parentId', 'isConnected', 'width', 'height']);
  for (const [key, val] of Object.entries(data)) {
    if (shown.has(key) || skipFields.has(key)) continue;
    if (val == null || val === '' || val === false) continue;
    if (typeof val === 'string' && val.length > 200) {
      lines.push(`**${key}**:\n${val}`);
    } else if (typeof val === 'object') {
      const json = JSON.stringify(val, null, 2);
      if (json.length > 5 && json !== '{}' && json !== '[]') {
        lines.push(`**${key}**:\n\`\`\`json\n${json}\n\`\`\``);
      }
    } else {
      lines.push(`**${key}**: ${val}`);
    }
  }

  return lines.join('\n');
}

export interface WorkflowEditDeps {
  contextBuilder: ContextBuilder;
  responseParser: ResponseParser;
  executeLLM: (
    provider: string,
    apiKey: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: string
  ) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
}

export async function processWorkflowEdit(
  sessionId: string,
  workflowId: string,
  request: EngineRequest,
  L: LangCode,
  pricing: { input: number; cachedInput?: number; output: number },
  deps: WorkflowEditDeps
): Promise<EngineResponse | null> {
  try {
    const workflow = await prisma.workflow.findFirst({
      where: { workflowId },
      select: { workflowJson: true, name: true },
    });

    if (!workflow?.workflowJson) {
      const message = t('editWorkflowFailed', L, { error: 'Workflow not found' });
      const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    const workflowData = JSON.parse(workflow.workflowJson);
    const existingWorkflow = {
      nodes: workflowData.nodes || [],
      edges: workflowData.edges || [],
    };

    if (isViewStructureRequest(request.prompt)) {
      const summary = buildWorkflowSummary(
        workflow.name || workflowId,
        existingWorkflow.nodes,
        existingWorkflow.edges
      );
      const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message: summary }));
      return { sessionId, type: 'answer', message: summary, usage: zeroUsage };
    }

    const nodeDetail = buildNodeDetailIfRequested(
      request.prompt,
      existingWorkflow.nodes,
    );
    if (nodeDetail) {
      const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message: nodeDetail }));
      return { sessionId, type: 'answer', message: nodeDetail, usage: zeroUsage };
    }

    const nodeDetection = detectContextsFromWorkflow(existingWorkflow);

    const { systemPrompt: basePrompt, userPrompt } = await deps.contextBuilder.build({
      userId: request.userId,
      prompt: request.prompt,
      context: 'general',
      agentId: request.agentId,
      existingWorkflow,
      templateSource: request.templateSource,
      isFollowUp: true,
      nodeDetection,
    });

    const codexContext = await buildCodexContext(request.prompt, existingWorkflow, false, request.templateSource);
    const codexPrompt = generateCodexPrompt(codexContext);

    let systemPrompt = basePrompt + '\n\n---\n\n' + codexPrompt;

    if (nodeDetection.mcpConnectionIds.length > 0 || nodeDetection.dataSheetIds.length > 0) {
      systemPrompt += await deps.contextBuilder.enrichWithLiveData(
        { userId: request.userId, agentId: request.agentId },
        nodeDetection.mcpConnectionIds,
        nodeDetection.dataSheetIds
      );
    }

    const historyMessages = await buildHierarchicalMessages(sessionId, systemPrompt);
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      ...historyMessages,
      { role: 'user', content: userPrompt },
    ];

    const llmResult = await deps.executeLLM(request.provider, request.apiKey, messages, request.model);

    if (!llmResult.content || llmResult.content.trim().length === 0) {
      const message = t('editWorkflowFailed', L, { error: 'Empty LLM response' });
      const usage = { inputTokens: llmResult.inputTokens, outputTokens: 0, model: request.model, pricing: { input: pricing.input, cachedInput: pricing.cachedInput, output: pricing.output } };
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage };
    }
    const parsed = deps.responseParser.parse(llmResult.content);

    await saveMessage(sessionId, 'user', request.prompt);
    await saveMessage(sessionId, 'assistant', llmResult.content);
    await checkAndSummarize(sessionId, request.provider, request.apiKey, request.azureConfig);

    const usage = {
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      model: request.model,
      pricing: { input: pricing.input, cachedInput: pricing.cachedInput, output: pricing.output },
    };

    if (parsed.type === 'modification' && parsed.changes?.length) {
      const result = await applyModificationsToWorkflow(workflowId, request.userId, parsed.changes);
      const message = result.success
        ? t('editWorkflowApplied', L) + '\n' + result.message
        : t('editWorkflowFailed', L, { error: result.message });
      return { sessionId, type: 'answer', message, usage };
    }

    if (parsed.type === 'workflow' && parsed.nodes && parsed.edges) {
      if (parsed.message) {
        return { sessionId, type: 'answer', message: parsed.message, usage };
      }
      const result = await replaceWorkflowJson(workflowId, request.userId, parsed.nodes, parsed.edges);
      const message = result.success
        ? t('editWorkflowApplied', L)
        : t('editWorkflowFailed', L, { error: result.message });
      return { sessionId, type: 'answer', message, usage };
    }

    const fallbackMessage = parsed.message
      || parsed.explanation
      || parsed.description
      || parsed.summary
      || (parsed.type === 'question' ? '질문이 있습니다.' : '요청을 처리했습니다.');
    return {
      sessionId,
      type: parsed.type === 'question' ? 'question' : 'answer',
      message: fallbackMessage,
      usage,
    };
  } catch (error) {
    console.error('[Engine] processWorkflowEdit failed:', error);
    const message = t('editWorkflowFailed', L, { error: error instanceof Error ? error.message : 'Unknown error' });
    const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
    return { sessionId, type: 'answer', message, usage: zeroUsage };
  }
}

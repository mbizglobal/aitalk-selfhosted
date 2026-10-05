'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkflowContext } from '../contexts/WorkflowContext';
import { Send, Sparkles, AlertCircle, CheckCircle2, ChevronDown, X, Play, Bot, Repeat, Square, FileSearch, Globe, GitBranch, GripVertical, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { restoreNodesWithIcons } from '../utils/nodeUtils';
import { SendGridIcon, TelegramIcon, SmsIcon } from '../constants/components';
import { MCPLogo } from '../nodes/icons/MCPLogo';
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio';
import { useLanguage } from '@/hooks/useLanguage';
import type { AIAssistantContext } from '@/lib/codex-lib/context-instructions';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  estimatedCost: number;
}

interface PendingChange {
  nodeId: string;
  path: string;
  action: 'set' | 'push' | 'remove' | 'merge';
  value: any;
}

interface DataSheetChange {
  sheetId: string;
  action: 'addColumn' | 'removeColumn' | 'modifyColumn' | 'updateSchema';
  column?: {
    name: string;
    type: string;
    required?: boolean;
  };
  schema?: {
    columns: Array<{ name: string; type: string; required?: boolean }>;
  };
}

interface PendingModification {
  changes: PendingChange[];
  dataSheetChanges?: DataSheetChange[];
  message: string;
}

function formatLongText(text: string): string {
  if (!text || text.length < 100) return text;

  let formatted = text;

  formatted = formatted.replace(/\s*\((\d+)\)\s*/g, '\n\n($1) ');

  formatted = formatted.replace(/\.\s+(\d+)\.\s+/g, '.\n\n$1. ');

  formatted = formatted.replace(/\s+([-•])\s+/g, '\n$1 ');

  formatted = formatted.replace(/^\n+/, '');

  return formatted;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

function getByPath(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function setByPath(obj: any, path: string, value: any): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null) {
      current[part] = isNaN(Number(parts[i + 1])) ? {} : [];
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function applyModifications(nodes: any[], changes: any[]): any[] {
  const updatedNodes = JSON.parse(JSON.stringify(nodes)); // Deep copy

  for (const change of changes) {
    const nodeIndex = updatedNodes.findIndex((n: any) => n.id === change.nodeId);
    if (nodeIndex === -1) {
      console.warn(`Node not found: ${change.nodeId}`);
      continue;
    }

    const node = updatedNodes[nodeIndex];
    const currentValue = getByPath(node, change.path);

    switch (change.action) {
      case 'set':
        setByPath(node, change.path, change.value);
        break;
      case 'push':
        if (Array.isArray(currentValue)) {
          currentValue.push(change.value);
        } else {
          setByPath(node, change.path, [change.value]);
        }
        break;
      case 'remove':
        if (Array.isArray(currentValue)) {
          const idx = currentValue.findIndex((item: any) =>
            JSON.stringify(item) === JSON.stringify(change.value) ||
            item === change.value ||
            item?.name === change.value ||
            (change.value?.id && item?.id === change.value.id) ||
            (typeof change.value === 'string' && item?.id === change.value)
          );
          if (idx !== -1) currentValue.splice(idx, 1);
        } else {
          // Remove field
          const pathParts = change.path.split('.');
          const fieldName = pathParts.pop();
          const parent = getByPath(node, pathParts.join('.'));
          if (parent && fieldName) delete parent[fieldName];
        }
        break;
      case 'merge':
        if (typeof currentValue === 'object' && currentValue !== null) {
          setByPath(node, change.path, { ...currentValue, ...change.value });
        } else {
          setByPath(node, change.path, change.value);
        }
        break;
    }
  }

  return updatedNodes;
}

import { getProviderModelsForUI, LLM_PROVIDER_REGISTRY } from '@/lib/ai-providers/core/registry';
import { MANAGED_REGIONS } from '@/lib/managed/regions';

const AI_ASSISTANT_MODELS = getProviderModelsForUI();

const MANAGED_MODEL_INFO: Record<string, { label: string; cpaCost: number }> = {
  'gpt-4.1-mini': { label: 'GPT-4.1 Mini', cpaCost: 1 },
  'gpt-4.1': { label: 'GPT-4.1', cpaCost: 1 },
  'gpt-6-luna': { label: 'GPT-6 Luna', cpaCost: 1 },
  'gpt-6-sol': { label: 'GPT-6 Sol', cpaCost: 1 },
  'gpt-5.1': { label: 'GPT-5.1', cpaCost: 1 },
  'gpt-5.4-mini': { label: 'GPT-5.4 Mini', cpaCost: 1 },
  'gpt-5.4': { label: 'GPT-5.4', cpaCost: 2 },
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-6-luna',
  claude: 'claude-opus-4-6',
  gemini: 'gemini-3-flash-preview',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-1-fast-reasoning',
  mistral: 'mistral-small-latest',
};

const AI_ASSISTANT_PROVIDERS = Object.entries(LLM_PROVIDER_REGISTRY).map(([id, def]) => ({
  value: id,
  label: def.name,
}));

// Node type to icon mapping
function getNodeIcon(nodeType: string) {
  switch (nodeType) {
    case 'start':
      return Play;
    case 'ai':
      return Bot;
    case 'condition':
      return GitBranch;
    case 'while':
      return Repeat;
    case 'end':
      return Square;
    case 'file-search':
      return FileSearch;
    default:
      return Bot;
  }
}

interface AIAssistantPanelProps {
  showPanel: boolean;
  onClose: () => void;
}

export function AIAssistantPanel({ showPanel, onClose }: AIAssistantPanelProps) {
  const { workflow, ui, agent } = useWorkflowContext();
  const { lang } = useLanguage();
  const t = getAgentStudioTranslation(lang);
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  const setNodes = workflow.setNodes;
  const setEdges = workflow.setEdges;
  const workflowId = agent.workflowId || null;

  const getContextLabel = useCallback((context: AIAssistantContext): string => {
    const key = `ai_context_${context}` as keyof typeof t;
    return (t[key] as string) || context;
  }, [t]);

  const aiContext = ui.aiAssistantContext || 'general';
  const aiNodeId = ui.aiAssistantNodeId;
  const prevContextRef = useRef<AIAssistantContext>(aiContext);
  const [showContextChangePrompt, setShowContextChangePrompt] = useState(false);
  const [pendingContext, setPendingContext] = useState<AIAssistantContext | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingModification, setPendingModification] = useState<PendingModification | null>(null);
  const [expandedChangeIndex, setExpandedChangeIndex] = useState<number | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('openai');
  const [selectedModel, setSelectedModel] = useState<string>('gpt-6-luna');
  const [providerApiKeyStatus, setProviderApiKeyStatus] = useState<Record<string, boolean>>({});
  const [isManaged, setIsManaged] = useState(false);
  const [managedRegion, setManagedRegion] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    turnCount: 0,
    estimatedCost: 0
  });
  const [currentPricing, setCurrentPricing] = useState<{ input: number; output: number }>({ input: 1.25, output: 10.00 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Position and size state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 840, height: 683 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>('');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const normalSize = { width: 840, height: 683 };
  const expandedSize = { width: 900, height: 700 };

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const response = await fetch('/api/dashboard/user-info');
        if (response.ok) {
          const data = await response.json();
          const sv = data.data?.serviceVariant;
          const region = data.data?.managedRegion;
          const managed = sv === 'managed';
          setIsManaged(managed);
          setManagedRegion(region || null);
          if (managed && region) {
            const regionInfo = MANAGED_REGIONS.find(r => r.id === region);
            if (regionInfo) {
              const regionModels = regionInfo.models as readonly string[];
              const defaultModel = regionModels.includes('gpt-6-luna') ? 'gpt-6-luna' : regionModels[0];
              setSelectedProvider('openai');
              setSelectedModel(defaultModel);
              setProviderApiKeyStatus({ openai: true });
              return;
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch user info:', err);
      }

      try {
        const response = await fetch('/api/settings/ai-providers');
        if (response.ok) {
          const data = await response.json();
          const status: Record<string, boolean> = {};
          data.providers?.forEach((p: { id: string; hasApiKey: boolean }) => {
            status[p.id] = p.hasApiKey;
          });
          setProviderApiKeyStatus(status);
        }
      } catch (err) {
        console.error('Failed to fetch API key status:', err);
      }
    };
    fetchUserInfo();
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (showPanel) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [showPanel]);

  useEffect(() => {
    if (aiContext !== 'general' && aiContext !== prevContextRef.current) {
      if (messages.length > 0) {
        setPendingContext(aiContext);
        setShowContextChangePrompt(true);
      }
    }
    prevContextRef.current = aiContext;
  }, [aiContext, messages.length]);

  const handleStartNewConversation = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/agent-studio/session?sessionId=${sessionId}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }

    setMessages([]);
    setSessionId(null);
    setError(null);
    setTokenUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      turnCount: 0,
      estimatedCost: 0
    });
    setShowContextChangePrompt(false);
    setPendingContext(null);
  }, [sessionId]);

  const handleContinueConversation = useCallback(() => {
    setShowContextChangePrompt(false);
    setPendingContext(null);
  }, []);

  useEffect(() => {
    if (showPanel && !isInitialized) {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const maxW = Math.min(size.width, windowWidth - 40);
      const maxH = Math.min(size.height, windowHeight - 60);
      if (maxW < size.width || maxH < size.height) {
        setSize({ width: maxW, height: maxH });
      }
      const newX = Math.max(20, Math.min((windowWidth - maxW) / 2 - 380, windowWidth - maxW - 20));
      const newY = Math.max(20, Math.min(windowHeight - maxH - 100, windowHeight - maxH - 20));
      setPosition({ x: newX, y: newY });
      setIsInitialized(true);
    }
  }, [showPanel, isInitialized, size.width, size.height]);

  useEffect(() => {
    if (!showPanel || !isInitialized) return;
    const handleResize = () => {
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      setSize(prev => ({
        width: Math.max(560, Math.min(prev.width, ww - 40)),
        height: Math.max(400, Math.min(prev.height, wh - 60)),
      }));
      setPosition(prev => ({
        x: Math.max(0, Math.min(prev.x, ww - 200)),
        y: Math.max(0, Math.min(prev.y, wh - 200)),
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showPanel, isInitialized]);

  // Handle drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    } else if (isResizing) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.posX;
      let newY = resizeStart.posY;

      // Handle horizontal resizing
      if (resizeDirection.includes('e')) {
        newWidth = Math.max(560, resizeStart.width + deltaX);
      } else if (resizeDirection.includes('w')) {
        newWidth = Math.max(560, resizeStart.width - deltaX);
        if (newWidth > 560) {
          newX = resizeStart.posX + deltaX;
        }
      }

      // Handle vertical resizing
      if (resizeDirection.includes('s')) {
        newHeight = Math.max(455, resizeStart.height + deltaY);
      } else if (resizeDirection.includes('n')) {
        newHeight = Math.max(455, resizeStart.height - deltaY);
        if (newHeight > 455) {
          newY = resizeStart.posY + deltaY;
        }
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    }
  }, [isDragging, isResizing, dragStart, resizeStart, resizeDirection]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection('');
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      // Prevent text selection during drag/resize
      document.body.style.userSelect = 'none';
      document.body.style.cursor = isDragging ? 'grabbing' : 'inherit';

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  // Handle resize
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y
    });
  }, [size, position]);

  const handleReset = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/agent-studio/session?sessionId=${sessionId}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }

    setMessages([]);
    setSessionId(null);
    setError(null);
    setTokenUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      turnCount: 0,
      estimatedCost: 0
    });
    setShowResetConfirm(false);
  }, [sessionId]);

  const handleResetClick = useCallback(() => {
    if (messages.length > 0) {
      setShowResetConfirm(true);
    }
  }, [messages.length]);

  const handleResetCancel = useCallback(() => {
    setShowResetConfirm(false);
  }, []);

  const syncToolNodes = useCallback((aiNodeId: string, newSelectedTools: any) => {
    const aiNode = nodes.find((n: any) => n.id === aiNodeId);
    if (!aiNode) return;

    const allToolTypes = [
      { key: 'source', icon: FileSearch, color: 'bg-yellow-500', label: 'Source', max: 1 },
      { key: 'mcp', icon: MCPLogo, color: 'bg-black', label: 'MCP', max: 10 },
      { key: 'webSearch', icon: Globe, color: 'bg-green-500', label: 'Web Search', max: 10 },
      { key: 'sendgrid', icon: SendGridIcon, color: 'bg-[#00A9D1]', label: 'SendGrid Email', max: 1, isApps: true },
      { key: 'telegram', icon: TelegramIcon, color: 'bg-gray-200', label: 'Telegram', max: 1, isApps: true },
      { key: 'sms', icon: SmsIcon, color: 'bg-sky-500', label: 'SMS', max: 1, isApps: true },
      { key: 'smtp', icon: Send, color: 'bg-purple-500', label: 'SMTP Email', max: 1, isApps: true },
    ] as const;

    const currentToolEdges = edges.filter(e => e.source === aiNodeId && e.sourceHandle === 'tools');
    const currentToolNodeIds = currentToolEdges.map(e => e.target);
    const currentToolNodes = nodes.filter(n => currentToolNodeIds.includes(n.id) && n.type === 'tool');

    const nodesToAdd: any[] = [];
    const edgesToAdd: any[] = [];
    const nodeIdsToRemove: string[] = [];

    let posIndex = currentToolNodes.length;

    for (const toolDef of allToolTypes) {
      const wantsEnabled = newSelectedTools[toolDef.key] === true;
      const existingNodes = currentToolNodes.filter(n => n.data?.toolType === toolDef.key);
      const hasNode = existingNodes.length > 0;

      if (wantsEnabled && !hasNode) {
        const toolNodeId = `tool-${toolDef.key}-${Date.now()}-${posIndex}`;
        const positions = [
          { x: 150, y: 150 }, { x: -150, y: 150 },
          { x: 150, y: 250 }, { x: -150, y: 250 },
          { x: 150, y: 350 }, { x: -150, y: 350 },
        ];
        const offset = positions[posIndex % positions.length] || { x: 0, y: 150 + posIndex * 100 };

        nodesToAdd.push({
          id: toolNodeId,
          type: 'tool',
          data: {
            label: toolDef.label,
            icon: toolDef.icon,
            color: toolDef.color,
            toolType: toolDef.key,
            ...(toolDef.isApps
              ? { nodeType: toolDef.key === 'sms' ? 'sms_infobip' : toolDef.key }
              : {}),
            isLoopTool: aiNode.data?.isLoopTool,
          },
          position: {
            x: aiNode.position.x + offset.x,
            y: aiNode.position.y + offset.y,
          },
        });

        edgesToAdd.push({
          id: `e-${aiNodeId}-${toolNodeId}`,
          source: aiNodeId,
          sourceHandle: 'tools',
          target: toolNodeId,
          type: 'toolEdge',
          animated: false,
          markerEnd: undefined,
          style: aiNode.data?.isLoopTool ? { stroke: '#f97316' } : undefined,
        });

        posIndex++;
      } else if (!wantsEnabled && hasNode) {
        for (const n of existingNodes) {
          nodeIdsToRemove.push(n.id);
        }
      }
    }

    if (nodesToAdd.length > 0 || nodeIdsToRemove.length > 0) {
      setTimeout(() => {
        setNodes(nds => {
          let updated = nodeIdsToRemove.length > 0
            ? nds.filter(n => !nodeIdsToRemove.includes(n.id))
            : [...nds];
          if (nodesToAdd.length > 0) {
            updated = [...updated, ...nodesToAdd];
          }
          return updated;
        });
        setTimeout(() => {
          setEdges(eds => {
            let updated = nodeIdsToRemove.length > 0
              ? eds.filter(e => !nodeIdsToRemove.includes(e.source) && !nodeIdsToRemove.includes(e.target))
              : [...eds];
            if (edgesToAdd.length > 0) {
              updated = [...updated, ...edgesToAdd];
            }
            return updated;
          });
        }, 100);
      }, 150);
    }
  }, [nodes, edges, setNodes, setEdges]);

  const handleApplyModification = useCallback(async () => {
    if (!pendingModification) return;

    const hasNodeChanges = pendingModification.changes && pendingModification.changes.length > 0;
    const hasDataSheetChanges = pendingModification.dataSheetChanges && pendingModification.dataSheetChanges.length > 0;

    if (!hasNodeChanges && !hasDataSheetChanges) return;

    try {
      let appliedCount = 0;

      if (hasNodeChanges) {
        const filteredChanges = pendingModification.changes.filter(change => {
          const node = nodes.find((n: any) => n.id === change.nodeId);
          if (node?.data?.nodeType === 'dataSheets') {
            console.warn(`Skipping change for Data Sheet node: ${change.nodeId}`);
            return false;
          }
          return true;
        });

        if (filteredChanges.length > 0) {
          const formattedChanges = filteredChanges.map(change => ({
            ...change,
            value: typeof change.value === 'string' ? formatLongText(change.value) : change.value
          }));

          const updatedNodes = applyModifications(nodes, formattedChanges);
          const nodesWithIcons = restoreNodesWithIcons(updatedNodes);
          setNodes(nodesWithIcons);
          appliedCount += filteredChanges.length;

          for (const change of filteredChanges) {
            if (change.path === 'data.selectedTools' && change.action === 'set') {
              syncToolNodes(change.nodeId, change.value);
            }
          }
        }
      }

      if (hasDataSheetChanges) {
        for (const dsChange of pendingModification.dataSheetChanges!) {
          if (dsChange.sheetId !== ui.aiAssistantDataSheetId) {
            console.warn(`Skipping Data Sheet change: sheetId mismatch (${dsChange.sheetId} !== ${ui.aiAssistantDataSheetId})`);
            continue;
          }

          const response = await fetch(`/api/agent-studio/data-sheets/${dsChange.sheetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schema: dsChange.schema })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update Data Sheet');
          }

          appliedCount++;
        }
      }

      const successMessage: Message = {
        role: 'system',
        content: `✅ ${appliedCount}${t.ai_assistant_changes_applied || '개 변경사항이 적용되었습니다.'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, successMessage]);
    } catch (err: any) {
      const errorMessage: Message = {
        role: 'system',
        content: `❌ ${t.ai_assistant_error || '오류:'} ${err.message}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setPendingModification(null);
      setExpandedChangeIndex(null);
    }
  }, [pendingModification, nodes, setNodes, t, ui.aiAssistantDataSheetId, syncToolNodes]);

  const handleCancelModification = useCallback(() => {
    setPendingModification(null);
    setExpandedChangeIndex(null);
    const cancelMessage: Message = {
      role: 'system',
      content: t.ai_assistant_changes_cancelled || '변경이 취소되었습니다.',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, cancelMessage]);
  }, [t]);

  const handleProviderChange = useCallback((newProvider: string) => {
    setSelectedProvider(newProvider);
    setSelectedModel(DEFAULT_MODELS[newProvider] || AI_ASSISTANT_MODELS[newProvider]?.[0]?.value || 'gpt-6-luna');
  }, []);

  // Handle expand/collapse toggle
  const handleExpandToggle = useCallback(() => {
    const newExpanded = !isExpanded;
    const newSize = newExpanded ? expandedSize : normalSize;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const deltaWidth = newSize.width - size.width;
    const deltaHeight = newSize.height - size.height;

    setSize(newSize);
    setPosition({
      x: Math.max(20, position.x - deltaWidth / 2),
      y: Math.max(20, position.y - deltaHeight / 2)
    });
    setIsExpanded(newExpanded);
  }, [isExpanded, size, position, expandedSize, normalSize]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agent-studio/codex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: input,
          sessionId,
          workflowId: workflowId || null,
          existingWorkflow: nodes.length > 0 ? { nodes, edges } : null,
          provider: selectedProvider,
          model: selectedModel,
          isFollowUp: !!sessionId,
          context: aiContext,
          nodeId: aiNodeId,
          dataSheetId: ui.aiAssistantDataSheetId,
          mcpConnectionId: ui.aiAssistantMcpConnectionId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.error || t.ai_assistant_error_generation_failed || 'Failed to generate workflow';
        if (data.errorCode) {
          switch (data.errorCode) {
            case 'LOGIN_REQUIRED':
              errorMsg = t.ai_assistant_error_login_required || 'Login required.';
              break;
            case 'PROMPT_REQUIRED':
              errorMsg = t.ai_assistant_error_prompt_required || 'Prompt is required.';
              break;
            case 'USER_NOT_FOUND':
              errorMsg = t.ai_assistant_error_user_not_found || 'User not found.';
              break;
            case 'API_KEY_NOT_SET':
              errorMsg = (t.ai_assistant_error_api_key_not_set || '{provider} API key is not set. Please set it in Settings.')
                .replace('{provider}', data.provider || 'Provider');
              break;
            case 'API_KEY_DECRYPT_FAILED':
              errorMsg = t.ai_assistant_error_api_key_decrypt_failed || 'Failed to decrypt API key. Please reset it in Settings.';
              break;
            case 'INVALID_API_KEY':
              errorMsg = (t.ai_assistant_error_invalid_api_key || 'Invalid {provider} API key.')
                .replace('{provider}', data.provider || 'Provider');
              break;
            case 'RATE_LIMIT_EXCEEDED':
              errorMsg = t.ai_assistant_error_rate_limit || 'Rate limit exceeded. Please try again later.';
              break;
            case 'RESPONSE_TOO_LONG':
              errorMsg = t.ai_assistant_error_response_too_long || 'Response too long. Please try a simpler request.';
              break;
            case 'RESPONSE_PARSE_ERROR':
              errorMsg = t.ai_assistant_error_parse_error || 'Error processing response. Please try again.';
              break;
            case 'GENERATION_FAILED':
              errorMsg = t.ai_assistant_error_generation_failed || 'Failed to generate workflow.';
              if (data.detail) errorMsg += ` (${data.detail})`;
              break;
          }
        }
        const debugInfo = data.debug?.rawResponse ? `\n\nDebug: ${data.debug.rawResponse}` : '';
        const fullErrorMsg = errorMsg + debugInfo;

        setError(fullErrorMsg);
        const errorMessage: Message = {
          role: 'system',
          content: `${t.ai_assistant_error} ${fullErrorMsg}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
        setLoading(false);
        return;
      }

      // Store session ID for conversation continuity
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      // Update token usage
      if (data.usage) {
        const { inputTokens, outputTokens, pricing } = data.usage;
        if (pricing) {
          setCurrentPricing({ input: pricing.input, output: pricing.output });
        }
        setTokenUsage(prev => {
          const newTotalInput = prev.totalInputTokens + inputTokens;
          const newTotalOutput = prev.totalOutputTokens + outputTokens;
          const newTurnCount = prev.turnCount + 1;
          const inputCost = (newTotalInput / 1000000) * (pricing?.input || currentPricing.input);
          const outputCost = (newTotalOutput / 1000000) * (pricing?.output || currentPricing.output);
          return {
            inputTokens,
            outputTokens,
            totalInputTokens: newTotalInput,
            totalOutputTokens: newTotalOutput,
            turnCount: newTurnCount,
            estimatedCost: inputCost + outputCost
          };
        });
      }

      // Handle different response types
      const responseType = data.type || 'workflow';

      console.log('[AI Assistant] Response type:', responseType, 'data:', data);

      if (responseType === 'answer') {
        // Codex is answering a question - just show the answer
        const answerMessage: Message = {
          role: 'assistant',
          content: data.message,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, answerMessage]);
      } else if (responseType === 'modification') {
        // Codex is returning modification instructions - store for confirmation
        const modMessage: Message = {
          role: 'assistant',
          content: data.message,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, modMessage]);

        const hasNodeChanges = data.changes && data.changes.length > 0;
        const hasDataSheetChanges = data.dataSheetChanges && data.dataSheetChanges.length > 0;

        if (hasNodeChanges || hasDataSheetChanges) {
          // Store pending changes for user confirmation
          setPendingModification({
            changes: data.changes || [],
            dataSheetChanges: data.dataSheetChanges || [],
            message: data.message
          });
        }
      } else if (responseType === 'question') {
        // Codex is asking clarifying questions - just show the message
        const questionMessage: Message = {
          role: 'assistant',
          content: data.message,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, questionMessage]);
      } else if (responseType === 'confirmation') {
        // Codex is asking for confirmation - show preview
        let confirmContent = data.message;
        if (data.preview) {
          confirmContent += '\n\n';
          if (data.preview.description) {
            confirmContent += `📋 ${data.preview.description}\n`;
          }
          if (data.preview.nodes && data.preview.nodes.length > 0) {
            confirmContent += `🔗 노드: ${data.preview.nodes.join(' → ')}\n`;
          }
          if (data.preview.features && data.preview.features.length > 0) {
            confirmContent += `✨ 기능: ${data.preview.features.join(', ')}`;
          }
        }
        const confirmMessage: Message = {
          role: 'assistant',
          content: confirmContent,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);
      } else if (responseType === 'workflow' && data.workflow) {
        // Workflow generated - apply to canvas
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message || t.ai_assistant_workflow_created,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Codex now generates complete Agent Studio format
        // Only need to transform JSON Schema if present
        const transformedNodes = data.workflow.nodes.map((node: any) => {
          // Transform JSON Schema format for AI nodes
          if (node.data.nodeType === 'ai' && node.data.jsonSchema && node.data.schemaName) {
            const originalSchema = node.data.jsonSchema;

            // Parse properties for Simple mode in JsonSchemaModal
            const schemaProperties: any[] = [];
            if (originalSchema.properties) {
              Object.entries(originalSchema.properties).forEach(([propName, propValue]: [string, any]) => {
                const baseProp: any = {
                  id: Date.now().toString() + Math.random(),
                  name: propName,
                  type: propValue.enum ? 'enum' : propValue.type,
                  description: propValue.description || '',
                  required: originalSchema.required?.includes(propName) || false,
                  enumValues: propValue.enum || undefined,
                };

                // OBJECT type: nested properties
                if (propValue.type === 'object' && propValue.properties) {
                  baseProp.properties = Object.entries(propValue.properties).map(([nestedName, nestedValue]: [string, any]) => ({
                    id: Date.now().toString() + Math.random(),
                    name: nestedName,
                    type: nestedValue.enum ? 'enum' : nestedValue.type,
                    description: nestedValue.description || '',
                    required: propValue.required?.includes(nestedName) || false,
                    enumValues: nestedValue.enum || undefined,
                  }));
                }

                // ARRAY type: items
                if (propValue.type === 'array' && propValue.items) {
                  const items = propValue.items;
                  baseProp.itemsType = items.enum ? 'enum' : items.type;
                  baseProp.itemsEnumValues = items.enum || undefined;

                  if (items.type === 'object' && items.properties) {
                    baseProp.itemsProperties = Object.entries(items.properties).map(([itemName, itemValue]: [string, any]) => ({
                      id: Date.now().toString() + Math.random(),
                      name: itemName,
                      type: itemValue.enum ? 'enum' : itemValue.type,
                      description: itemValue.description || '',
                      required: items.required?.includes(itemName) || false,
                      enumValues: itemValue.enum || undefined,
                    }));
                  }
                }

                schemaProperties.push(baseProp);
              });
            }

            return {
              ...node,
              data: {
                ...node.data,
                jsonSchema: {
                  name: node.data.schemaName,
                  strict: true,
                  schema: {
                    ...node.data.jsonSchema,
                    additionalProperties: false
                  }
                },
                schemaProperties // Add parsed properties for Simple mode
              }
            };
          }

          // All other nodes pass through unchanged
          return node;
        });

        // Restore icons for nodes (icon: null → actual icon component)
        const nodesWithIcons = restoreNodesWithIcons(transformedNodes);

        setNodes(nodesWithIcons);
        setEdges(data.workflow.edges);

        // Add success message
        const successMessage: Message = {
          role: 'system',
          content: t.ai_assistant_workflow_applied,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, successMessage]);
      } else {
        // Fallback: just show the message
        const fallbackMessage: Message = {
          role: 'assistant',
          content: data.message || t.ai_assistant_response_received,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, fallbackMessage]);
      }

    } catch (error: any) {
      console.error('AI Assistant error:', error);
      setError(error.message);

      const errorMessage: Message = {
        role: 'system',
        content: `${t.ai_assistant_error} ${error.message}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getExamplesForContext = (context: AIAssistantContext) => {
    const contextKey = context === 'general' ? 'general' : context;
    const key1 = `ai_assistant_example_${contextKey}_1` as keyof typeof t;
    const key2 = `ai_assistant_example_${contextKey}_2` as keyof typeof t;
    const key3 = `ai_assistant_example_${contextKey}_3` as keyof typeof t;

    if (t[key1] && t[key2] && t[key3]) {
      return [t[key1], t[key2], t[key3]];
    }
    return [t.ai_assistant_example_general_1, t.ai_assistant_example_general_2, t.ai_assistant_example_general_3];
  };

  const examplePrompts = getExamplesForContext(aiContext);

  if (!showPanel) return null;

  return (
    <div className="fixed inset-0 z-[10001] pointer-events-none">
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #111111;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #374151;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4B5563;
        }
        .messages-area,
        .messages-area * {
          user-select: text !important;
          -webkit-user-select: text !important;
        }
      `}</style>
      <div
        ref={panelRef}
        className="absolute pointer-events-auto flex flex-col bg-[#1A1A1A] rounded-xl shadow-2xl border border-[#3A3A3A]"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          cursor: isDragging ? 'grabbing' : 'default'
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#252525] border-b border-[#3A3A3A] rounded-t-xl drag-handle cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Drag Icon + AI Assistant */}
            <GripVertical className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <div className="p-1.5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-white flex-shrink-0">{t.ai_assistant_title}</span>
            {/* Context Badge */}
            {aiContext !== 'general' && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30 truncate max-w-[120px]">
                {getContextLabel(aiContext)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Provider Selection */}
            <div
              className="relative flex-shrink-0"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {isManaged ? (
                <span className="pl-2 pr-2 py-1 text-xs font-medium bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-white inline-flex items-center gap-1">
                  Azure OpenAI
                </span>
              ) : (
                <>
                  <select
                    value={selectedProvider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="appearance-none pl-2 pr-6 py-1 text-xs font-medium bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white cursor-pointer hover:bg-[#252525]"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {AI_ASSISTANT_PROVIDERS.map((provider) => {
                      const hasApiKey = providerApiKeyStatus[provider.value] !== false;
                      return (
                        <option
                          key={provider.value}
                          value={provider.value}
                          disabled={!hasApiKey}
                          className={!hasApiKey ? 'text-gray-500' : ''}
                        >
                          {provider.label}{!hasApiKey ? ' (No API Key)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                </>
              )}
            </div>

            {/* Model Selection */}
            <div
              className="relative flex-shrink-0"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="appearance-none pl-2 pr-6 py-1 text-xs font-medium bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white cursor-pointer hover:bg-[#252525]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {isManaged ? (
                  (() => {
                    const regionInfo = MANAGED_REGIONS.find(r => r.id === managedRegion);
                    return regionInfo ? (regionInfo.models as readonly string[])
                      .filter(m => !m.startsWith('gpt-realtime'))
                      .map(m => (
                      <option key={m} value={m}>
                        {MANAGED_MODEL_INFO[m]?.label || m} ({MANAGED_MODEL_INFO[m]?.cpaCost || 1}x)
                      </option>
                    )) : null;
                  })()
                ) : (
                  (AI_ASSISTANT_MODELS[selectedProvider] || []).map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label} ({model.price})
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetClick}
              className="p-1 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded-lg transition-colors"
              title={t.ai_assistant_reset || '초기화'}
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Expand/Collapse Toggle Button */}
            <button
              onClick={handleExpandToggle}
              className="p-1 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded-lg transition-colors"
              title={isExpanded ? t.collapse : t.expand}
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Context Change Confirmation Prompt */}
        {showContextChangePrompt && (
          <div className="px-4 py-3 bg-gradient-to-r from-purple-900/30 to-blue-900/30 border-b border-purple-500/30">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-purple-500/20 rounded-lg">
                <Sparkles className="w-4 h-4 text-purple-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 mb-2">
                  <span className="font-medium text-purple-300">{getContextLabel(pendingContext || 'general')}</span> {t.ai_assistant_context_switch}
                </p>
                <p className="text-xs text-gray-400 mb-3">{t.ai_assistant_keep_conversation_question}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleStartNewConversation}
                    className="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                  >
                    {t.ai_assistant_new_conversation}
                  </button>
                  <button
                    onClick={handleContinueConversation}
                    className="px-3 py-1.5 text-xs font-medium bg-[#3A3A3A] hover:bg-[#4A4A4A] text-gray-200 rounded-lg transition-colors"
                  >
                    {t.ai_assistant_continue_conversation}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reset Confirmation Prompt */}
        {showResetConfirm && (
          <div className="px-4 py-3 bg-gradient-to-r from-orange-900/30 to-red-900/30 border-b border-orange-500/30">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-orange-500/20 rounded-lg">
                <RotateCcw className="w-4 h-4 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 mb-2">{t.ai_assistant_reset_confirm_title}</p>
                <p className="text-xs text-gray-400 mb-3">{t.ai_assistant_reset_confirm_message}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors"
                  >
                    {t.ai_assistant_reset_confirm}
                  </button>
                  <button
                    onClick={handleResetCancel}
                    className="px-3 py-1.5 text-xs font-medium bg-[#3A3A3A] hover:bg-[#4A4A4A] text-gray-200 rounded-lg transition-colors"
                  >
                    {t.ai_assistant_reset_cancel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pending Modification Preview */}
        {pendingModification && (
          <div className="px-4 py-3 bg-gradient-to-r from-blue-900/30 to-cyan-900/30 border-b border-blue-500/30">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-blue-500/20 rounded-lg flex-shrink-0">
                <Sparkles className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 mb-2">{t.ai_assistant_pending_changes_title || '변경 내용 확인'}</p>
                <div className="space-y-2 mb-3 max-h-64 overflow-y-auto custom-scrollbar">
                  {pendingModification.changes
                    .filter(change => {
                      if (!change.nodeId) return false;
                      const node = nodes.find((n: any) => n.id === change.nodeId);
                      return node?.data?.nodeType !== 'dataSheets';
                    })
                    .map((change, idx) => {
                    const node = change.nodeId ? nodes.find((n: any) => n.id === change.nodeId) : null;
                    const nodeName = node?.data?.label || change.nodeId?.slice(0, 8) || 'Unknown';
                    const pathParts = (change.path || '').split('.');
                    const fieldName = pathParts[pathParts.length - 1] || 'unknown';
                    const rawValue = change.value === undefined ? 'undefined' : (typeof change.value === 'string' ? change.value : JSON.stringify(change.value, null, 2)) || '';
                    const fullValue = formatLongText(rawValue);
                    const isLong = rawValue.length > 50;
                    const isExpanded = expandedChangeIndex === idx;
                    const displayValue = isExpanded ? fullValue : (isLong ? rawValue.slice(0, 50) + '...' : rawValue);

                    return (
                      <div key={idx} className="bg-[#1A1A1A]/50 rounded-lg p-2">
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span className="text-blue-300 font-medium">{nodeName}</span>
                          <span className="text-gray-500">→</span>
                          <span className="text-cyan-300">{fieldName}</span>
                          {isLong && (
                            <button
                              onClick={() => setExpandedChangeIndex(isExpanded ? null : idx)}
                              className="ml-auto text-gray-400 hover:text-white text-[10px] px-1.5 py-0.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded transition-colors"
                            >
                              {isExpanded ? (t.ai_assistant_collapse || '접기') : (t.ai_assistant_expand || '펼치기')}
                            </button>
                          )}
                        </div>
                        <div className={`text-xs text-green-300 select-text ${isExpanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}>
                          {displayValue}
                        </div>
                      </div>
                    );
                  })}

                  {pendingModification.dataSheetChanges && pendingModification.dataSheetChanges.map((dsChange, idx) => {
                    const columnsPreview = dsChange.schema?.columns
                      ? dsChange.schema.columns.map((c: any) => `${c.name} (${c.type})`).join(', ')
                      : '';

                    return (
                      <div key={`ds-${idx}`} className="bg-[#1A1A1A]/50 rounded-lg p-2 border border-purple-500/30">
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span className="text-purple-300 font-medium">📊 Data Sheet</span>
                          <span className="text-gray-500">→</span>
                          <span className="text-cyan-300">{dsChange.action}</span>
                        </div>
                        <div className="text-xs text-green-300 truncate">
                          {columnsPreview || JSON.stringify(dsChange.column || dsChange.schema)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleApplyModification}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                  >
                    {t.ai_assistant_pending_changes_apply || '적용'}
                  </button>
                  <button
                    onClick={handleCancelModification}
                    className="px-3 py-1.5 text-xs font-medium bg-[#3A3A3A] hover:bg-[#4A4A4A] text-gray-200 rounded-lg transition-colors"
                  >
                    {t.ai_assistant_pending_changes_cancel || '취소'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Messages Area */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar messages-area"
        tabIndex={0}
        onMouseUp={(e) => {
          const selection = window.getSelection();
          if (selection && selection.toString().length > 0) {
            (e.currentTarget as HTMLDivElement).focus();
          }
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
              e.preventDefault();
              navigator.clipboard.writeText(selection.toString());
            }
          }
        }}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#374151 #111111'
        }}
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-4 space-y-3">
            <div className="inline-block p-2 bg-gradient-to-br from-blue-900/20 to-purple-900/20 rounded-2xl">
              <Sparkles className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium mb-1 text-gray-300">{t.ai_assistant_greeting}</p>
              <p className="text-xs text-gray-500">{t.ai_assistant_question}</p>
            </div>

            <div className="space-y-2 max-w-2xl mx-auto">
              <p className="text-xs font-medium text-gray-400">{t.ai_assistant_examples}</p>
              {examplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => setInput(prompt)}
                  className="block w-full text-left px-3 py-2 text-xs bg-[#252525] hover:bg-[#2A2A2A] rounded-lg transition-colors text-gray-300 border border-[#3A3A3A]"
                >
                  💡 {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 select-text ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white'
                  : msg.role === 'system'
                  ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                  : 'bg-[#252525] text-gray-200 border border-[#3A3A3A]'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm prose-invert max-w-none break-words text-sm select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_code]:bg-gray-700 [&_code]:px-1 [&_code]:rounded [&_a]:text-blue-400 [&_a]:underline">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm select-text">{msg.content}</div>
              )}
              <div
                className={`text-xs mt-1 ${
                  msg.role === 'user'
                    ? 'text-blue-200'
                    : msg.role === 'system'
                    ? 'text-yellow-400'
                    : 'text-gray-500'
                }`}
              >
                {msg.timestamp.toLocaleTimeString(
                  lang === 'ko' ? 'ko-KR' : lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-US',
                  { hour: '2-digit', minute: '2-digit' }
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#252525] rounded-xl px-3 py-2 border border-[#3A3A3A]">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>{t.ai_assistant_generating}</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-3 py-2 flex items-start gap-2 max-w-[80%]">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-300">{error}</div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {tokenUsage.turnCount > 0 && !isManaged && (
        <div className="px-3 py-2 bg-[#1F1F1F] border-t border-[#3A3A3A] flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-gray-500">Turn {tokenUsage.turnCount}</span>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">In:</span>
              <span className="text-blue-400 font-mono">{formatTokens(tokenUsage.totalInputTokens)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">Out:</span>
              <span className="text-green-400 font-mono">{formatTokens(tokenUsage.totalOutputTokens)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-yellow-400 font-medium">{formatCost(tokenUsage.estimatedCost)}</span>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 bg-[#252525] border-t border-[#3A3A3A] rounded-b-xl">
        <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={t.ai_assistant_placeholder}
              className="flex-1 px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500 resize-none text-sm"
              rows={2}
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="px-4 py-2 bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-medium"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span className="text-sm">{t.ai_assistant_send}</span>
                </>
              )}
            </button>
          </div>

        {sessionId && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span>{t.ai_assistant_connected}</span>
          </div>
        )}
      </div>

      {/* Resize Handles - 8 directions */}
      {/* Top */}
      <div
        className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeMouseDown(e, 'n')}
      />
      {/* Bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeMouseDown(e, 's')}
      />
      {/* Left */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1 cursor-ew-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeMouseDown(e, 'w')}
      />
      {/* Right */}
      <div
        className="absolute top-0 bottom-0 right-0 w-1 cursor-ew-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeMouseDown(e, 'e')}
      />
      {/* Top-Left */}
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize hover:bg-blue-500"
        onMouseDown={(e) => handleResizeMouseDown(e, 'nw')}
      />
      {/* Top-Right */}
      <div
        className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize hover:bg-blue-500"
        onMouseDown={(e) => handleResizeMouseDown(e, 'ne')}
      />
      {/* Bottom-Left */}
      <div
        className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize hover:bg-blue-500"
        onMouseDown={(e) => handleResizeMouseDown(e, 'sw')}
      />
      {/* Bottom-Right */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize hover:bg-blue-500"
        onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
      />
      </div>
    </div>
  );
}

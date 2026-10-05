'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, Sparkles, RotateCcw, Save, Trash2, Star, Check, X, Mail, Link2, ExternalLink, Bot } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { AssistantHeader } from './AssistantHeader';
import { AssistantInput } from './AssistantInput';
import { AI_ASSISTANT_PROVIDERS, DEFAULT_MODELS, formatTokens, formatCost } from './constants';
import { useLanguage } from '@/hooks/useLanguage';
import { useSession } from 'next-auth/react';
import { MANAGED_REGIONS } from '@/lib/managed/regions';

interface SettingsAction {
  type: 'add_api_key' | 'delete_api_key' | 'set_default_provider' | 'add_pinecone_api_key' | 'reset_pinecone' | 'change_email'
  | 'add_telegram_bot' | 'delete_telegram_bot' | 'add_slack_bot' | 'delete_slack_bot' | 'create_agent';
  provider: string;
  completed?: boolean;
  result?: 'success' | 'error';
}

interface WorkflowAction {
  type: 'delete_workflow';
  workflowId: string;
  completed?: boolean;
  result?: 'success' | 'error';
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  errorCode?: string;
  vaultEnabled?: boolean;
  action?: SettingsAction;
  workflowAction?: WorkflowAction;
  onboardingButtons?: { label: string; data: string }[] | null;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  estimatedCost: number;
}

interface AssistantPanelProps {
  agentId: string;
  agentTitle: string;
  onAgentTitleChange: (title: string) => void;
  isExpanded: boolean;
  onExpandToggle: () => void;
  onClose: () => void;
}

export function AssistantPanel({ agentId, agentTitle, onAgentTitleChange: setAgentTitle, isExpanded, onExpandToggle, onClose }: AssistantPanelProps) {
  const { t: translate, currentLanguage: lang } = useLanguage();
  const t = (key: string) => translate(key);
  const { data: session } = useSession();
  const userName = session?.user?.name || 'User';

  // Workflow data
  const [workflowData, setWorkflowData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(true);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Provider/Model (restore from localStorage)
  const [selectedProvider, setSelectedProvider] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dashboardAssistantProvider') || 'openai';
    }
    return 'openai';
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dashboardAssistantModel') || 'gpt-5-mini';
    }
    return 'gpt-5-mini';
  });
  const [providerApiKeyStatus, setProviderApiKeyStatus] = useState<Record<string, boolean>>({});
  const [isManaged, setIsManaged] = useState(false);
  const [managedRegion, setManagedRegion] = useState<string | null>(null);

  // Session
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Token tracking
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    inputTokens: 0, outputTokens: 0,
    totalInputTokens: 0, totalOutputTokens: 0,
    turnCount: 0, estimatedCost: 0,
  });
  const [currentPricing, setCurrentPricing] = useState<{ input: number; output: number }>({ input: 0.25, output: 2.00 });

  // UI state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevAgentIdRef = useRef(agentId);

  const fetchApiKeyStatus = useCallback(async () => {
    try {
      const userRes = await fetch('/api/dashboard/user-info');
      if (userRes.ok) {
        const userData = await userRes.json();
        const sv = userData.data?.serviceVariant;
        const region = userData.data?.managedRegion;
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
            localStorage.setItem('dashboardAssistantProvider', 'openai');
            localStorage.setItem('dashboardAssistantModel', defaultModel);
            setProviderApiKeyStatus({ openai: true });
            return;
          }
        }
      }
    } catch {
      // ignore
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
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchApiKeyStatus();
  }, [fetchApiKeyStatus]);

  // Listen for provider API key changes from Settings page
  useEffect(() => {
    const handleProviderChanged = () => fetchApiKeyStatus();
    window.addEventListener('providerApiKeyChanged', handleProviderChanged);
    return () => window.removeEventListener('providerApiKeyChanged', handleProviderChanged);
  }, [fetchApiKeyStatus]);

  useEffect(() => {
    if (isManaged) return;
    const hasKeys = Object.keys(providerApiKeyStatus).length > 0;
    if (!hasKeys) return; // Status not loaded yet

    // If current provider has a key, keep it
    if (providerApiKeyStatus[selectedProvider]) return;

    // Find first provider with a key (in list order)
    const firstAvailable = AI_ASSISTANT_PROVIDERS.find(p => providerApiKeyStatus[p.value]);
    if (firstAvailable) {
      const newProvider = firstAvailable.value;
      const newModel = DEFAULT_MODELS[newProvider] || '';
      setSelectedProvider(newProvider);
      setSelectedModel(newModel);
      localStorage.setItem('dashboardAssistantProvider', newProvider);
      localStorage.setItem('dashboardAssistantModel', newModel);
    }
  }, [providerApiKeyStatus, selectedProvider, isManaged]);

  // Fetch workflow data when agentId changes
  useEffect(() => {
    const fetchWorkflow = async () => {
      if (!agentId) {
        setWorkflowData(null);
        setWorkflowId(null);
        setWorkflowLoading(false);
        return;
      }

      setWorkflowLoading(true);
      try {
        const response = await fetch(`/api/agents/${agentId}/workflows/production`);
        if (response.ok) {
          const data = await response.json();
          setWorkflowData(data.workflow);
          setWorkflowId(data.workflowId);
        } else {
          setWorkflowData(null);
          setWorkflowId(null);
        }
      } catch {
        setWorkflowData(null);
        setWorkflowId(null);
      } finally {
        setWorkflowLoading(false);
      }
    };

    fetchWorkflow();
  }, [agentId]);

  // Reset state when agentId changes
  useEffect(() => {
    if (agentId !== prevAgentIdRef.current) {
      prevAgentIdRef.current = agentId;
      resetState();
    }
  }, [agentId]);

  // Auto-trigger onboarding when panel opens (onboardStep < 5)
  const onboardTriggeredRef = useRef(false);
  useEffect(() => {
    if (!agentId || workflowLoading || onboardTriggeredRef.current || messages.length > 0) return;
    onboardTriggeredRef.current = true;
    handleSend('__onboard_start__');
  }, [agentId, workflowLoading]);

  // Reset onboard trigger when agentId changes
  useEffect(() => {
    onboardTriggeredRef.current = false;
  }, [agentId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const resetState = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/agent-studio/session?sessionId=${sessionId}`, { method: 'DELETE' });
      } catch {
        // ignore
      }
    }
    setMessages([]);
    setSessionId(null);
    setError(null);
    setErrorCode(null);
    setTokenUsage({
      inputTokens: 0, outputTokens: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      turnCount: 0, estimatedCost: 0,
    });
    setShowResetConfirm(false);
  }, [sessionId]);

  const handleResetClick = useCallback(() => {
    if (messages.length > 0) {
      setShowResetConfirm(true);
    }
  }, [messages.length]);

  const handleSend = async (autoFollowUp?: string) => {
    const messageText = autoFollowUp || input.trim();
    if (!messageText || (!autoFollowUp && loading)) return;

    if (!autoFollowUp) {
      const userMessage: Message = {
        role: 'user',
        content: messageText,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);
      setInput('');
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      // Safe serialization: strip non-serializable values (DOM elements, functions, Symbols)
      const safeWorkflow = workflowData && workflowData.nodes?.length > 0
        ? JSON.parse(JSON.stringify(workflowData, (_, v) =>
          v instanceof Element || typeof v === 'function' || typeof v === 'symbol' ? undefined : v
        ))
        : null;

      const response = await fetch('/api/agent-studio/codex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: messageText,
          sessionId,
          workflowId: workflowId || null,
          existingWorkflow: safeWorkflow,
          provider: selectedProvider,
          model: selectedModel,
          isFollowUp: !!sessionId,
          context: 'dashboard',
          providerStatus: providerApiKeyStatus,
          agentId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.error || t('dashboard_ai_error_generation');
        if (data.errorCode) {
          switch (data.errorCode) {
            case 'LOGIN_REQUIRED':
              errorMsg = t('dashboard_ai_error_login');
              break;
            case 'API_KEY_NOT_SET':
              errorMsg = data.vaultEnabled
                ? t('dashboard_ai_error_api_key_vault').replace('{provider}', data.provider || 'Provider')
                : t('dashboard_ai_error_api_key').replace('{provider}', data.provider || 'Provider');
              break;
            case 'API_KEY_DECRYPT_FAILED':
              errorMsg = t('dashboard_ai_error_decrypt');
              break;
            case 'RATE_LIMIT_EXCEEDED':
              errorMsg = t('dashboard_ai_error_rate_limit');
              break;
            default:
              if (data.errorCode === 'GENERATION_FAILED' && data.detail) {
                errorMsg = `${t('dashboard_ai_error_generation')} (${data.detail})`;
              }
          }
        }
        const currentErrorCode = data.errorCode || null;
        const isVaultActive = data.vaultEnabled === true;
        setError(errorMsg);
        setErrorCode(currentErrorCode);
        setMessages(prev => [...prev, { role: 'system', content: errorMsg, timestamp: new Date(), errorCode: currentErrorCode, vaultEnabled: isVaultActive }]);
        setLoading(false);
        return;
      }

      // Store session ID
      if (data.sessionId) setSessionId(data.sessionId);

      // Update token usage
      if (data.usage) {
        const { inputTokens, outputTokens, pricing } = data.usage;
        if (pricing) {
          setCurrentPricing({ input: pricing.input, output: pricing.output });
        }
        setTokenUsage(prev => {
          const newTotalInput = prev.totalInputTokens + inputTokens;
          const newTotalOutput = prev.totalOutputTokens + outputTokens;
          const inputCost = (newTotalInput / 1000000) * (pricing?.input || currentPricing.input);
          const outputCost = (newTotalOutput / 1000000) * (pricing?.output || currentPricing.output);
          return {
            inputTokens, outputTokens,
            totalInputTokens: newTotalInput,
            totalOutputTokens: newTotalOutput,
            turnCount: prev.turnCount + 1,
            estimatedCost: inputCost + outputCost,
          };
        });
      }

      // Handle response
      const responseType = data.type || 'answer';

      if (responseType === 'onboarding_skip') {
        setLoading(false);
        return;
      }

      if (responseType === 'onboarding') {
        const buttons = data.value?.buttons as { label: string; data: string }[] | undefined;
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message || '',
          timestamp: new Date(),
          onboardingButtons: buttons || null,
        };
        setMessages(prev => [...prev, assistantMessage]);

        if (data.value?.agentTitle) {
          setAgentTitle(data.value.agentTitle);
          window.dispatchEvent(new CustomEvent('agentTitleChanged', { detail: { agentId, title: data.value.agentTitle } }));
        }
        if (data.value?.userName) {
          window.dispatchEvent(new CustomEvent('profileChanged'));
        }

        setLoading(false);
        return;
      }

      if (responseType === 'settings_action') {
        if (data.action === 'update_pinecone_config' || data.action === 'set_rag_provider') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.message || '',
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, assistantMessage]);
          window.dispatchEvent(new CustomEvent('ragProviderChanged'));
        } else if (data.action === 'update_profile') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.message || '',
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, assistantMessage]);
          window.dispatchEvent(new CustomEvent('profileChanged'));
          if (data.value?.locale) {
            const localeMap: Record<string, string> = { 'en-US': 'en', 'de-DE': 'de', 'fr-FR': 'fr', 'es-ES': 'es', 'ko-KR': 'ko' };
            const lang = localeMap[data.value.locale] || 'en';
            localStorage.setItem('preferredLanguage', lang);
            window.dispatchEvent(new CustomEvent('languageChanged'));
          }
        } else if (data.action === 'change_email') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.message || '',
            timestamp: new Date(),
            action: {
              type: 'change_email',
              provider: 'email',
            },
          };
          setMessages(prev => [...prev, assistantMessage]);
          if (data.value && typeof data.value === 'string' && data.value.includes('@')) {
            setActionEmailInput(data.value);
          }
        } else if (data.action === 'add_pinecone_api_key' || data.action === 'reset_pinecone') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.message || '',
            timestamp: new Date(),
            action: {
              type: data.action,
              provider: 'pinecone',
            },
          };
          setMessages(prev => [...prev, assistantMessage]);
        } else if (data.action === 'add_telegram_bot' || data.action === 'delete_telegram_bot'
          || data.action === 'add_slack_bot' || data.action === 'delete_slack_bot' || data.action === 'create_agent') {
          const platform = data.action.includes('telegram') ? 'telegram' : data.action.includes('slack') ? 'slack' : '';
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.message || '',
            timestamp: new Date(),
            action: {
              type: data.action,
              provider: platform,
            },
          };
          setMessages(prev => [...prev, assistantMessage]);
        } else {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.message || '',
            timestamp: new Date(),
            action: {
              type: data.action,
              provider: data.provider,
            },
          };
          setMessages(prev => [...prev, assistantMessage]);
        }
      } else if (responseType === 'workflow_action') {
        if (data.action === 'delete_workflow') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.message || t('dashboard_ai_wf_delete_confirm'),
            timestamp: new Date(),
            workflowAction: {
              type: 'delete_workflow',
              workflowId: data.value?.workflowId,
            },
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.message || t('dashboard_ai_response_received'),
            timestamp: new Date(),
          }]);
          window.dispatchEvent(new CustomEvent('workflowChanged'));
          if (data.action === 'create_workflow' || data.action === 'change_status') {
            try {
              const wfRes = await fetch(`/api/agents/${agentId}/workflows/production`);
              if (wfRes.ok) {
                const wfData = await wfRes.json();
                setWorkflowData(wfData.workflow);
                setWorkflowId(wfData.workflowId);
              }
            } catch { /* ignore */ }
          }
        }
      } else {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message || t('dashboard_ai_response_received'),
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        if (data.message && (data.message.includes('✅') || data.message.includes('Changes applied') || data.message.includes('변경 적용'))) {
          window.dispatchEvent(new CustomEvent('workflowChanged'));
          try {
            const wfRes = await fetch(`/api/agents/${agentId}/workflows/production`);
            if (wfRes.ok) {
              const wfData = await wfRes.json();
              setWorkflowData(wfData.workflow);
              setWorkflowId(wfData.workflowId);
            }
          } catch { /* ignore */ }
        }
      }

    } catch (err: any) {
      const errorMsg = err.message || t('dashboard_ai_error_generation');
      setError(errorMsg);
      setMessages(prev => [...prev, { role: 'system', content: errorMsg, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const [actionApiKeyInput, setActionApiKeyInput] = useState('');
  const [actionEmailInput, setActionEmailInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [botTokenInput, setBotTokenInput] = useState('');
  const [slackClientId, setSlackClientId] = useState('');
  const [slackClientSecret, setSlackClientSecret] = useState('');
  const [slackSigningSecret, setSlackSigningSecret] = useState('');
  const [slackPreConfigDone, setSlackPreConfigDone] = useState(false);

  const handleAddApiKey = async (msgIndex: number, provider: string) => {
    if (!actionApiKeyInput.trim() || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/settings/ai-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: actionApiKeyInput }),
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok ? (data.message || `${provider} API key saved.`) : (data.error || 'Failed to save API key.'),
        timestamp: new Date(),
      }]);
      if (response.ok) {
        setActionApiKeyInput('');
        const statusRes = await fetch('/api/settings/ai-providers');
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const status: Record<string, boolean> = {};
          statusData.providers?.forEach((p: { id: string; hasApiKey: boolean }) => { status[p.id] = p.hasApiKey; });
          setProviderApiKeyStatus(status);
        }
        window.dispatchEvent(new CustomEvent('providerApiKeyChanged'));
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to save API key.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteApiKey = async (msgIndex: number, provider: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch(`/api/settings/ai-providers?provider=${provider}`, { method: 'DELETE' });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok ? (data.message || `${provider} API key deleted.`) : (data.error || 'Failed to delete API key.'),
        timestamp: new Date(),
      }]);
      if (response.ok) {
        const statusRes = await fetch('/api/settings/ai-providers');
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const status: Record<string, boolean> = {};
          statusData.providers?.forEach((p: { id: string; hasApiKey: boolean }) => { status[p.id] = p.hasApiKey; });
          setProviderApiKeyStatus(status);
        }
        window.dispatchEvent(new CustomEvent('providerApiKeyChanged'));
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to delete API key.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetDefaultProvider = async (msgIndex: number, provider: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/settings/ai-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, setAsDefault: true }),
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok ? (data.message || `${provider} set as default.`) : (data.error || 'Failed to set default provider.'),
        timestamp: new Date(),
      }]);
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to set default provider.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelAction = (msgIndex: number) => {
    setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
      ...msg,
      action: { ...msg.action!, completed: true, result: 'error' }
    } : msg));
    setMessages(prev => [...prev, { role: 'system' as const, content: t('dashboard_ai_reset_cancel'), timestamp: new Date() }]);
    setActionApiKeyInput('');
  };

  const handleChangeEmail = async (msgIndex: number) => {
    const newEmail = actionEmailInput.trim();
    if (!newEmail || actionLoading) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Invalid email format.', timestamp: new Date() }]);
      return;
    }
    setActionLoading(true);
    try {
      const response = await fetch('/api/dashboard/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail, language: lang || 'en' }),
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      if (response.ok) {
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: t('dashboard_ai_email_sent') || `Verification email sent to ${newEmail}. Please check your inbox.`,
          timestamp: new Date(),
        }]);
        setActionEmailInput('');
      } else {
        const errorMap: Record<string, string> = {
          'INVALID_EMAIL': 'Invalid email format.',
          'SAME_EMAIL': 'This is the same as your current email.',
          'EMAIL_EXISTS': 'This email is already in use.',
          'EMAIL_SEND_FAILED': t('dashboard_ai_email_failed') || 'Failed to send verification email.',
        };
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: errorMap[data.error] || data.error || t('dashboard_ai_email_failed') || 'Failed to send verification email.',
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: t('dashboard_ai_email_failed') || 'Failed to send verification email.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddPineconeApiKey = async (msgIndex: number) => {
    if (!actionApiKeyInput.trim() || actionLoading) return;
    setActionLoading(true);
    try {
      const getRes = await fetch('/api/storage/rag-provider');
      let currentDefault = 'none';
      if (getRes.ok) {
        const getData = await getRes.json();
        currentDefault = getData.defaultProvider || 'none';
      }
      const response = await fetch('/api/storage/rag-provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultProvider: currentDefault,
          pineconeConfig: { apiKey: actionApiKeyInput },
        }),
      });
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok ? 'Pinecone API key saved.' : 'Failed to save Pinecone API key.',
        timestamp: new Date(),
      }]);
      if (response.ok) {
        setActionApiKeyInput('');
        window.dispatchEvent(new CustomEvent('ragProviderChanged'));
        setTimeout(() => {
          handleSend('Pinecone API key saved. Continue Pinecone setup - ask for Index Name and Embedding Model.');
        }, 500);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to save Pinecone API key.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPinecone = async (msgIndex: number) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/storage/rag-provider', { method: 'DELETE' });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok ? (data.message || 'Pinecone settings reset.') : 'Failed to reset Pinecone settings.',
        timestamp: new Date(),
      }]);
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('ragProviderChanged'));
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to reset Pinecone settings.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteWorkflow = async (msgIndex: number, workflowId: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        workflowAction: { ...msg.workflowAction!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok ? (data.message || t('dashboard_ai_wf_deleted')) : (data.error || t('dashboard_ai_wf_delete_failed')),
        timestamp: new Date(),
      }]);
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('workflowChanged'));
        try {
          const wfRes = await fetch(`/api/agents/${agentId}/workflows/production`);
          if (wfRes.ok) {
            const wfData = await wfRes.json();
            setWorkflowData(wfData.workflow);
            setWorkflowId(wfData.workflowId);
          } else {
            setWorkflowData(null);
            setWorkflowId(null);
          }
        } catch { /* ignore */ }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: t('dashboard_ai_wf_delete_failed'), timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelWorkflowAction = (msgIndex: number) => {
    setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
      ...msg,
      workflowAction: { ...msg.workflowAction!, completed: true, result: 'error' }
    } : msg));
    setMessages(prev => [...prev, { role: 'system' as const, content: t('dashboard_ai_reset_cancel'), timestamp: new Date() }]);
  };

  const handleAddTelegramBot = async (msgIndex: number) => {
    if (!botTokenInput.trim() || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, platform: 'telegram', botToken: botTokenInput }),
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      if (response.ok) {
        setBotTokenInput('');
        if (data.pendingVerification) {
          const botUsername = data.botUsername || 'your_bot';
          const verificationCode = data.verificationCode || '';
          setMessages(prev => [...prev, {
            role: 'system' as const,
            content: `Bot token verified! Send **${verificationCode}** to [@${botUsername}](https://t.me/${botUsername}) in Telegram to complete the setup.`,
            timestamp: new Date(),
          }]);
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            if (attempts > 20) { clearInterval(pollInterval); return; }
            try {
              const statusRes = await fetch('/api/settings/channels');
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                const ch = statusData.channels?.find((c: any) => c.agentId === agentId && c.platform === 'telegram');
                if (ch?.status === 'active') {
                  clearInterval(pollInterval);
                  setMessages(prev => [...prev, {
                    role: 'system' as const,
                    content: `Telegram bot @${ch.botUsername || botUsername} is now **active**!`,
                    timestamp: new Date(),
                  }]);
                  window.dispatchEvent(new CustomEvent('channelChanged'));
                }
              }
            } catch { /* ignore */ }
          }, 3000);
        } else {
          setMessages(prev => [...prev, {
            role: 'system' as const,
            content: data.message || 'Telegram bot connected.',
            timestamp: new Date(),
          }]);
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: data.error || 'Failed to connect Telegram bot.',
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to connect Telegram bot.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddSlackBot = async (msgIndex: number) => {
    if (!slackClientId.trim() || !slackClientSecret.trim() || !slackSigningSecret.trim() || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId, platform: 'slack',
          slackClientId, slackClientSecret, slackSigningSecret,
        }),
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      if (response.ok) {
        setSlackClientId('');
        setSlackClientSecret('');
        setSlackSigningSecret('');
        if (data.pendingOAuth) {
          const eventsUrl = data.eventsUrl || '';
          const redirectUrl = data.oauthRedirectUrl || '';
          const oauthUrl = `/api/bots/slack/oauth?agentId=${encodeURIComponent(agentId)}`;
          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            content: `**Slack App에서 추가 설정이 필요합니다:**\n\n**Step 4.** 왼쪽 메뉴 **Event Subscriptions** → **Enable Events** 켜기 → **Request URL**에 입력:\n\`${eventsUrl}\`\n(입력 후 "Verified" 표시 확인)\n\n**Step 5.** 아래 **Subscribe to bot events** → **Add Bot User Event**:\n\`message.im\`, \`app_mention\` 추가 → **Save Changes**\n\n**Step 6.** 아래 버튼으로 Workspace에 설치:`,
            timestamp: new Date(),
            action: {
              type: 'add_slack_bot' as const,
              provider: 'slack_oauth',
              completed: false,
            },
          }]);
          (window as any).__slackOAuthUrl = oauthUrl;
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            if (attempts > 40) { clearInterval(pollInterval); return; }
            try {
              const statusRes = await fetch('/api/settings/channels');
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                const ch = statusData.channels?.find((c: any) => c.agentId === agentId && c.platform === 'slack');
                if (ch?.status === 'active') {
                  clearInterval(pollInterval);
                  setMessages(prev => [...prev, {
                    role: 'system' as const,
                    content: `Slack bot is now **active** in workspace "${ch.slackTeamName || 'your workspace'}"!`,
                    timestamp: new Date(),
                  }]);
                  window.dispatchEvent(new CustomEvent('channelChanged'));
                }
              }
            } catch { /* ignore */ }
          }, 3000);
        } else {
          setMessages(prev => [...prev, {
            role: 'system' as const,
            content: data.message || 'Slack bot connected.',
            timestamp: new Date(),
          }]);
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: data.error || 'Failed to connect Slack bot.',
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: 'Failed to connect Slack bot.', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteBot = async (msgIndex: number, platform: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/settings/channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, platform }),
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: response.ok
          ? `${platform === 'telegram' ? 'Telegram' : 'Slack'} bot disconnected.`
          : (data.error || `Failed to disconnect ${platform} bot.`),
        timestamp: new Date(),
      }]);
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('channelChanged'));
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: `Failed to disconnect ${platform} bot.`, timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateAgent = async (msgIndex: number) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setMessages(prev => prev.map((msg, i) => i === msgIndex ? {
        ...msg,
        action: { ...msg.action!, completed: true, result: response.ok ? 'success' : 'error' }
      } : msg));

      if (response.ok) {
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: lang === 'ko' ? '에이전트가 생성되었습니다. 변경사항을 반영하려면 페이지를 새로고침해주세요.' : 'Agent created successfully. Please refresh the page.',
          timestamp: new Date(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: data.error || (lang === 'ko' ? '에이전트 생성 실패' : 'Failed to create agent'),
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system' as const, content: lang === 'ko' ? '오류 발생' : 'An error occurred', timestamp: new Date() }]);
    } finally {
      setActionLoading(false);
    }
  };

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard_ai_greeting_morning');
    if (hour < 18) return t('dashboard_ai_greeting_afternoon');
    return t('dashboard_ai_greeting_evening');
  };

  const greetingText = t('dashboard_ai_greeting')
    .replace('{greeting}', getTimeGreeting())
    .replace('{name}', userName);

  const examplePrompts = [
    t('dashboard_ai_example_1'),
    t('dashboard_ai_example_2'),
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
        :root.dark .custom-scrollbar::-webkit-scrollbar-track {
          background: #111111;
        }
        :root.dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #374151;
        }
        :root.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4B5563;
        }
        .messages-area,
        .messages-area * {
          user-select: text !important;
          -webkit-user-select: text !important;
        }
      `}</style>

      {/* Header */}
      <AssistantHeader
        agentTitle={agentTitle}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        providerApiKeyStatus={providerApiKeyStatus}
        isExpanded={isExpanded}
        onProviderChange={(p) => { setSelectedProvider(p); localStorage.setItem('dashboardAssistantProvider', p); }}
        onModelChange={(m) => { setSelectedModel(m); localStorage.setItem('dashboardAssistantModel', m); }}
        onResetClick={handleResetClick}
        onExpandToggle={onExpandToggle}
        onClose={onClose}
        hasMessages={messages.length > 0}
        t={t}
        isManaged={isManaged}
        managedRegion={managedRegion}
      />

      {/* Reset Confirmation */}
      {showResetConfirm && (
        <div className="px-4 py-3 bg-gradient-to-r from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 border-b border-orange-200 dark:border-orange-500/30">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-orange-100 dark:bg-orange-500/20 rounded-lg">
              <RotateCcw className="w-4 h-4 text-orange-500 dark:text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 dark:text-gray-200 mb-2">{t('dashboard_ai_reset_title')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('dashboard_ai_reset_message')}</p>
              <div className="flex gap-2">
                <button
                  onClick={resetState}
                  className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors"
                >
                  {t('dashboard_ai_reset_confirm')}
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] dark:text-gray-200 rounded-lg transition-colors"
                >
                  {t('dashboard_ai_reset_cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar messages-area"
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
      >
        {/* Empty state: greeting + examples */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 space-y-3">
            {workflowLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">{t('dashboard_ai_loading_workflow')}</span>
              </div>
            ) : !workflowData ? (
              <p className="text-sm">{t('dashboard_ai_no_workflow')}</p>
            ) : (
              <>
                <div className="inline-block p-2 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl">
                  <Sparkles className="w-8 h-8 text-blue-500 dark:text-blue-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{greetingText}</p>
                </div>
                <div className="space-y-2 w-full max-w-sm">
                  {examplePrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        const answerKeys: Record<number, string> = {
                          0: 'dashboard_ai_telegram_answer',
                          1: 'dashboard_ai_apikey_answer',
                        };
                        const answerKey = answerKeys[idx];
                        if (answerKey) {
                          const answer = t(answerKey);
                          setMessages(prev => [
                            ...prev,
                            { role: 'user', content: prompt, timestamp: new Date() },
                            { role: 'assistant', content: answer, timestamp: new Date() },
                          ]);
                        } else {
                          setInput(prompt);
                        }
                      }}
                      className="block w-full text-left px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-[#252525] dark:hover:bg-[#2A2A2A] rounded-lg transition-colors text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-[#3A3A3A]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 select-text ${msg.role === 'user'
                ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white'
                : msg.role === 'system'
                  ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700/50'
                  : 'bg-gray-100 dark:bg-[#252525] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-[#3A3A3A]'
                }`}
            >
              {msg.role === 'assistant' ? (
                <>
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_code]:bg-gray-200 dark:[&_code]:bg-gray-700 [&_code]:px-1 [&_code]:rounded [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {/* Onboarding Buttons */}
                  {msg.onboardingButtons && msg.onboardingButtons.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#3A3A3A] flex gap-2">
                      {msg.onboardingButtons.map((btn, btnIdx) => (
                        <button
                          key={btnIdx}
                          onClick={() => {
                            setMessages(prev => prev.map((m, i) => i === idx ? { ...m, onboardingButtons: null } : m));
                            handleSend(btn.data);
                          }}
                          disabled={loading}
                          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Settings Action UI */}
                  {msg.action && !msg.action.completed && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#3A3A3A]">
                      {msg.action.type === 'add_api_key' && (
                        <div className="space-y-2">
                          <input
                            type="password"
                            placeholder="API Key"
                            value={actionApiKeyInput}
                            onChange={e => setActionApiKeyInput(e.target.value)}
                            autoComplete="new-password"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAddApiKey(idx, msg.action!.provider)}
                              disabled={!actionApiKeyInput.trim() || actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                            >
                              {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                            <button
                              onClick={() => handleCancelAction(idx)}
                              disabled={actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                            >
                              <X className="w-3 h-3" />
                              {t('dashboard_ai_reset_cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {msg.action.type === 'delete_api_key' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeleteApiKey(idx, msg.action!.provider)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('ai_providers_delete') || 'Delete'}
                          </button>
                          <button
                            onClick={() => handleCancelAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                      {msg.action.type === 'set_default_provider' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSetDefaultProvider(idx, msg.action!.provider)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Star className="w-3 h-3" />}
                            Confirm
                          </button>
                          <button
                            onClick={() => handleCancelAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                      {msg.action.type === 'change_email' && (
                        <div className="space-y-2">
                          <input
                            type="email"
                            placeholder={t('dashboard_ai_email_placeholder') || 'New email address'}
                            value={actionEmailInput}
                            onChange={e => setActionEmailInput(e.target.value)}
                            autoComplete="off"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleChangeEmail(idx)}
                              disabled={!actionEmailInput.trim() || actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                            >
                              {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Mail className="w-3 h-3" />}
                              {t('dashboard_ai_email_send_verification') || 'Send Verification'}
                            </button>
                            <button
                              onClick={() => { handleCancelAction(idx); setActionEmailInput(''); }}
                              disabled={actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                            >
                              <X className="w-3 h-3" />
                              {t('dashboard_ai_reset_cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {msg.action.type === 'add_pinecone_api_key' && (
                        <div className="space-y-2">
                          <input
                            type="password"
                            placeholder="Pinecone API Key"
                            value={actionApiKeyInput}
                            onChange={e => setActionApiKeyInput(e.target.value)}
                            autoComplete="new-password"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAddPineconeApiKey(idx)}
                              disabled={!actionApiKeyInput.trim() || actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                            >
                              {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                            <button
                              onClick={() => handleCancelAction(idx)}
                              disabled={actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                            >
                              <X className="w-3 h-3" />
                              {t('dashboard_ai_reset_cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {msg.action.type === 'reset_pinecone' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleResetPinecone(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Reset
                          </button>
                          <button
                            onClick={() => handleCancelAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                      {msg.action.type === 'add_telegram_bot' && (
                        <div className="space-y-2">
                          <input
                            type="password"
                            placeholder="Bot Token"
                            value={botTokenInput}
                            onChange={e => setBotTokenInput(e.target.value)}
                            autoComplete="new-password"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAddTelegramBot(idx)}
                              disabled={!botTokenInput.trim() || actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                            >
                              {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Link2 className="w-3 h-3" />}
                              Connect
                            </button>
                            <button
                              onClick={() => { handleCancelAction(idx); setBotTokenInput(''); }}
                              disabled={actionLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                            >
                              <X className="w-3 h-3" />
                              {t('dashboard_ai_reset_cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {msg.action.type === 'add_slack_bot' && msg.action.provider !== 'slack_oauth' && (
                        <div className="space-y-2">
                          {!slackPreConfigDone ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => setSlackPreConfigDone(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                {t('dashboard_ai_slack_preconfig_done')}
                              </button>
                              <button
                                onClick={() => handleCancelAction(idx)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                              >
                                <X className="w-3 h-3" />
                                {t('dashboard_ai_reset_cancel')}
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Basic Information → Client ID, Client Secret, Signing Secret</p>
                              <input
                                type="text"
                                placeholder="Client ID"
                                value={slackClientId}
                                onChange={e => setSlackClientId(e.target.value)}
                                autoComplete="off"
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <input
                                type="password"
                                placeholder="Client Secret"
                                value={slackClientSecret}
                                onChange={e => setSlackClientSecret(e.target.value)}
                                autoComplete="new-password"
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <input
                                type="password"
                                placeholder="Signing Secret"
                                value={slackSigningSecret}
                                onChange={e => setSlackSigningSecret(e.target.value)}
                                autoComplete="new-password"
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#4A4A4A] bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleAddSlackBot(idx)}
                                  disabled={!slackClientId.trim() || !slackClientSecret.trim() || !slackSigningSecret.trim() || actionLoading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                                >
                                  {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Link2 className="w-3 h-3" />}
                                  Connect
                                </button>
                                <button
                                  onClick={() => { handleCancelAction(idx); setSlackClientId(''); setSlackClientSecret(''); setSlackSigningSecret(''); setSlackPreConfigDone(false); }}
                                  disabled={actionLoading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                  {t('dashboard_ai_reset_cancel')}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {msg.action.type === 'add_slack_bot' && msg.action.provider === 'slack_oauth' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const oauthUrl = (window as any).__slackOAuthUrl;
                              if (oauthUrl) {
                                window.open(oauthUrl, '_blank', 'width=600,height=700');
                              }
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Install to Workspace
                          </button>
                        </div>
                      )}
                      {msg.action.type === 'delete_telegram_bot' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeleteBot(idx, 'telegram')}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('ai_providers_delete') || 'Delete'}
                          </button>
                          <button
                            onClick={() => handleCancelAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                      {msg.action.type === 'delete_slack_bot' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeleteBot(idx, 'slack')}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('ai_providers_delete') || 'Delete'}
                          </button>
                          <button
                            onClick={() => handleCancelAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                      {msg.action.type === 'create_agent' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCreateAgent(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Bot className="w-3 h-3" />}
                            Create Agent
                          </button>
                          <button
                            onClick={() => handleCancelAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Action completed indicator */}
                  {msg.action?.completed && (
                    <div className={`mt-2 flex items-center gap-1 text-xs ${msg.action.result === 'success' ? 'text-green-500' : 'text-gray-400'}`}>
                      {msg.action.result === 'success' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {msg.action.result === 'success' ? 'Done' : 'Cancelled'}
                    </div>
                  )}
                  {/* Workflow Action UI: delete confirmation */}
                  {msg.workflowAction && !msg.workflowAction.completed && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#3A3A3A]">
                      {msg.workflowAction.type === 'delete_workflow' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeleteWorkflow(idx, msg.workflowAction!.workflowId)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                          >
                            {actionLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('ai_providers_delete') || 'Delete'}
                          </button>
                          <button
                            onClick={() => handleCancelWorkflowAction(idx)}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4A] text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t('dashboard_ai_reset_cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Workflow action completed indicator */}
                  {msg.workflowAction?.completed && (
                    <div className={`mt-2 flex items-center gap-1 text-xs ${msg.workflowAction.result === 'success' ? 'text-green-500' : 'text-gray-400'}`}>
                      {msg.workflowAction.result === 'success' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {msg.workflowAction.result === 'success' ? 'Done' : 'Cancelled'}
                    </div>
                  )}
                </>
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm select-text">
                  {msg.content}
                  {msg.errorCode === 'API_KEY_NOT_SET' && (
                    <Link
                      href={msg.vaultEnabled ? '/app/settings?tab=security' : '/app/settings?tab=api-key'}
                      className="block mt-2 text-xs font-medium underline hover:no-underline"
                    >
                      {msg.vaultEnabled ? 'Settings → Security →' : 'Settings → API Key →'}
                    </Link>
                  )}
                </div>
              )}
              <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' :
                msg.role === 'system' ? 'text-yellow-500 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'
                }`}>
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
            <div className="bg-gray-100 dark:bg-[#252525] rounded-xl px-3 py-2 border border-gray-200 dark:border-[#3A3A3A]">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>{t('dashboard_ai_generating')}</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 rounded-xl px-3 py-2 flex items-start gap-2 max-w-[80%]">
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-600 dark:text-red-300">
                {error}
                {errorCode === 'API_KEY_NOT_SET' && (
                  <Link
                    href={messages.some(m => m.vaultEnabled) ? '/app/settings?tab=security' : '/app/settings?tab=api-key'}
                    className="block mt-1 text-xs font-medium underline hover:no-underline"
                  >
                    {messages.some(m => m.vaultEnabled) ? 'Settings → Security →' : 'Settings → API Key →'}
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Token Usage Display */}
      {tokenUsage.turnCount > 0 && !isManaged && (
        <div className="flex-shrink-0 px-3 py-2 bg-gray-50 dark:bg-[#1F1F1F] border-t border-gray-200 dark:border-[#3A3A3A] flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-gray-400 dark:text-gray-500">Turn {tokenUsage.turnCount}</span>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 dark:text-gray-400">In:</span>
              <span className="text-blue-600 dark:text-blue-400 font-mono">{formatTokens(tokenUsage.totalInputTokens)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 dark:text-gray-400">Out:</span>
              <span className="text-green-600 dark:text-green-400 font-mono">{formatTokens(tokenUsage.totalOutputTokens)}</span>
            </div>
          </div>
          <span className="text-yellow-600 dark:text-yellow-400 font-medium">{formatCost(tokenUsage.estimatedCost)}</span>
        </div>
      )}

      {/* Input */}
      <AssistantInput
        input={input}
        loading={loading}
        showPanel={true}
        onInputChange={setInput}
        onSend={handleSend}
        t={t}
      />
    </div>
  );
}

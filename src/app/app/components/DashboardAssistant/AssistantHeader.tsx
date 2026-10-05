'use client';

import { ChevronDown, X, Maximize2, Minimize2, RotateCcw, Sparkles } from 'lucide-react';
import { AI_ASSISTANT_PROVIDERS, AI_ASSISTANT_MODELS, DEFAULT_MODELS } from './constants';
import { MANAGED_REGIONS } from '@/lib/managed/regions';

const MANAGED_MODEL_INFO: Record<string, { label: string; cpaCost: number }> = {
  'gpt-4.1-mini': { label: 'GPT-4.1 Mini', cpaCost: 1 },
  'gpt-4.1': { label: 'GPT-4.1', cpaCost: 1 },
  'gpt-6-luna': { label: 'GPT-6 Luna', cpaCost: 1 },
  'gpt-6-sol': { label: 'GPT-6 Sol', cpaCost: 1 },
  'gpt-5.1': { label: 'GPT-5.1', cpaCost: 1 },
};

interface AssistantHeaderProps {
  agentTitle: string;
  selectedProvider: string;
  selectedModel: string;
  providerApiKeyStatus: Record<string, boolean>;
  isExpanded: boolean;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  onResetClick: () => void;
  onExpandToggle: () => void;
  onClose: () => void;
  hasMessages: boolean;
  t: (key: string) => string;
  isManaged?: boolean;
  managedRegion?: string | null;
}

export function AssistantHeader({
  agentTitle,
  selectedProvider,
  selectedModel,
  providerApiKeyStatus,
  isExpanded,
  onProviderChange,
  onModelChange,
  onResetClick,
  onExpandToggle,
  onClose,
  hasMessages,
  t,
  isManaged = false,
  managedRegion = null,
}: AssistantHeaderProps) {
  const handleProviderChange = (newProvider: string) => {
    onProviderChange(newProvider);
    onModelChange(DEFAULT_MODELS[newProvider] || AI_ASSISTANT_MODELS[newProvider]?.[0]?.value || '');
  };

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-[#252525] border-b border-gray-200 dark:border-[#3A3A3A]">
      <div className="hidden sm:flex items-center gap-2 min-w-0 flex-1">
        <div className="p-1.5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-white flex-shrink-0">{t('dashboard_ai_title')}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]">{agentTitle}</span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Provider Selection */}
        <div className="relative flex-shrink-0">
          {isManaged ? (
            <span className="pl-2 pr-2 py-1 text-xs font-medium bg-white dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#3A3A3A] rounded-lg text-gray-900 dark:text-white inline-flex items-center gap-1">
              Azure OpenAI
            </span>
          ) : (
            <>
              <select
                value={selectedProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="appearance-none pl-2 pr-6 py-1 text-xs font-medium bg-white dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#3A3A3A] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white cursor-pointer hover:bg-gray-50 dark:hover:bg-[#252525]"
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
        <div className="relative flex-shrink-0">
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="appearance-none pl-2 pr-6 py-1 text-xs font-medium bg-white dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#3A3A3A] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white cursor-pointer hover:bg-gray-50 dark:hover:bg-[#252525]"
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
          onClick={onResetClick}
          disabled={!hasMessages}
          className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={t('dashboard_ai_reset')}
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Expand/Collapse Toggle */}
        <button
          onClick={onExpandToggle}
          className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded-lg transition-colors"
        >
          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

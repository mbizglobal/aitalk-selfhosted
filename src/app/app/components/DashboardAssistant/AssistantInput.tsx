'use client';

import { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface AssistantInputProps {
  input: string;
  loading: boolean;
  showPanel: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  t: (key: string) => string;
}

export function AssistantInput({
  input,
  loading,
  showPanel,
  onInputChange,
  onSend,
  t,
}: AssistantInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showPanel) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [showPanel]);

  useEffect(() => {
    if (!loading && showPanel) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loading, showPanel]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex-shrink-0 p-3 bg-gray-50 dark:bg-[#252525] border-t border-gray-200 dark:border-[#3A3A3A] rounded-b-xl">
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={t('dashboard_ai_placeholder')}
          className="flex-1 px-3 py-2 bg-white dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#3A3A3A] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none text-sm"
          rows={2}
          disabled={loading}
        />
        <button
          onClick={() => onSend()}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-medium self-end"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

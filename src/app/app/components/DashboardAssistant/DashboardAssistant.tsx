'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { AssistantPanel } from './AssistantPanel';

const DEFAULT_SIZE = { width: 600, height: 900 };
const EXPANDED_SIZE = { width: 900, height: 1350 };
const MIN_SIZE = { width: 360, height: 400 };

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DashboardAssistantProps {
  agentId: string | null;
  agentTitle: string;
  onAgentTitleChange: (title: string) => void;
}

export function DashboardAssistant({ agentId, agentTitle, onAgentTitleChange }: DashboardAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [customSize, setCustomSize] = useState<{ width: number; height: number } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startLeft: 0, startTop: 0 });
  const resizeRef = useRef<{
    active: boolean;
    direction: ResizeDirection;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startLeft: number;
    startTop: number;
  }>({ active: false, direction: 'se', startX: 0, startY: 0, startWidth: 0, startHeight: 0, startLeft: 0, startTop: 0 });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleToggle = useCallback(() => setIsOpen(prev => !prev), []);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const handleExpandToggle = useCallback(() => {
    setIsExpanded(prev => !prev);
    setCustomSize(null);
    setPosition(null);
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, startLeft: rect.left, startTop: rect.top };
    document.body.style.userSelect = 'none';
  }, [isMobile]);

  const handleResizeStart = useCallback((direction: ResizeDirection) => (e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    resizeRef.current = {
      active: true,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startLeft: rect.left,
      startTop: rect.top,
    };
    document.body.style.userSelect = 'none';
  }, [isMobile]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragRef.current.active) {
        const { startX, startY, startLeft, startTop } = dragRef.current;
        const newX = Math.max(0, Math.min(startLeft + (e.clientX - startX), window.innerWidth - 100));
        const newY = Math.max(0, Math.min(startTop + (e.clientY - startY), window.innerHeight - 50));
        setPosition({ x: newX, y: newY });
        return;
      }

      if (resizeRef.current.active) {
        const r = resizeRef.current;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;
        const maxW = window.innerWidth - 48;
        const maxH = window.innerHeight - 48;

        let newW = r.startWidth;
        let newH = r.startHeight;
        let newX = r.startLeft;
        let newY = r.startTop;

        if (r.direction.includes('e')) {
          newW = Math.max(MIN_SIZE.width, Math.min(r.startWidth + dx, maxW));
        }
        if (r.direction.includes('w')) {
          const dw = Math.min(dx, r.startWidth - MIN_SIZE.width);
          newW = Math.max(MIN_SIZE.width, r.startWidth - dw);
          newX = r.startLeft + dw;
        }
        if (r.direction.includes('s')) {
          newH = Math.max(MIN_SIZE.height, Math.min(r.startHeight + dy, maxH));
        }
        if (r.direction === 'n' || r.direction === 'ne' || r.direction === 'nw') {
          const dh = Math.min(dy, r.startHeight - MIN_SIZE.height);
          newH = Math.max(MIN_SIZE.height, r.startHeight - dh);
          newY = r.startTop + dh;
        }

        setCustomSize({ width: newW, height: newH });
        setPosition({ x: Math.max(0, newX), y: Math.max(0, newY) });
      }
    };

    const handleMouseUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        document.body.style.userSelect = '';
      }
      if (resizeRef.current.active) {
        resizeRef.current.active = false;
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (!agentId) return null;

  const baseSize = isExpanded ? EXPANDED_SIZE : DEFAULT_SIZE;
  const size = customSize || baseSize;

  const panelStyle: React.CSSProperties = isMobile
    ? {}
    : position
      ? { left: position.x, top: position.y, width: size.width, height: size.height, maxHeight: 'calc(100vh - 48px)' }
      : { right: 24, bottom: 24, width: Math.min(size.width, typeof window !== 'undefined' ? window.innerWidth - 48 : size.width), height: size.height, maxHeight: 'calc(100vh - 48px)' };

  const handle = 'absolute z-10 opacity-0 hover:opacity-100 transition-opacity';
  const handleBg = 'bg-blue-500/20';

  return (
    <>
      {/* {!isOpen && (
        <button
          onClick={handleToggle}
          className="fixed bottom-6 right-6 z-[9999] w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center group"
          aria-label="AI Assistant"
        >
          <Sparkles className="w-7 h-7 text-white group-hover:animate-pulse" />
        </button>
      )} */}

      <div
        ref={panelRef}
        className={`fixed z-[10001] ${isMobile ? 'inset-0' : ''} ${!isOpen ? 'pointer-events-none invisible' : ''}`}
        style={panelStyle}
      >
        {!isMobile && isOpen && (
          <>
            <div onMouseDown={handleResizeStart('n')}  className={`${handle} top-0 left-2 right-2 h-1 cursor-n-resize ${handleBg}`} />
            <div onMouseDown={handleResizeStart('s')}  className={`${handle} bottom-0 left-2 right-2 h-1 cursor-s-resize ${handleBg}`} />
            <div onMouseDown={handleResizeStart('e')}  className={`${handle} right-0 top-2 bottom-2 w-1 cursor-e-resize ${handleBg}`} />
            <div onMouseDown={handleResizeStart('w')}  className={`${handle} left-0 top-2 bottom-2 w-1 cursor-w-resize ${handleBg}`} />
            <div onMouseDown={handleResizeStart('nw')} className={`${handle} top-0 left-0 w-3 h-3 cursor-nw-resize ${handleBg} rounded-tl-xl`} />
            <div onMouseDown={handleResizeStart('ne')} className={`${handle} top-0 right-0 w-3 h-3 cursor-ne-resize ${handleBg} rounded-tr-xl`} />
            <div onMouseDown={handleResizeStart('sw')} className={`${handle} bottom-0 left-0 w-3 h-3 cursor-sw-resize ${handleBg} rounded-bl-xl`} />
            <div onMouseDown={handleResizeStart('se')} className={`${handle} bottom-0 right-0 w-3 h-3 cursor-se-resize ${handleBg} rounded-br-xl`} />
          </>
        )}

        <div
          className={`bg-white dark:bg-[#1A1A1A] shadow-2xl border border-gray-200 dark:border-[#3A3A3A] flex flex-col ${
            isMobile ? 'w-full h-full' : 'w-full h-full rounded-xl'
          }`}
          style={isMobile ? undefined : { maxHeight: 'calc(100vh - 48px)' }}
        >
          {!isMobile && (
            <div
              onMouseDown={handleDragStart}
              className="flex items-center justify-center h-5 cursor-grab active:cursor-grabbing rounded-t-xl bg-gray-50 dark:bg-[#252525] border-b border-gray-200 dark:border-[#3A3A3A] flex-shrink-0 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] transition-colors"
            >
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>
          )}
          <AssistantPanel
            agentId={agentId}
            agentTitle={agentTitle}
            onAgentTitleChange={onAgentTitleChange}
            isExpanded={isExpanded}
            onExpandToggle={handleExpandToggle}
            onClose={handleClose}
          />
        </div>
      </div>
    </>
  );
}

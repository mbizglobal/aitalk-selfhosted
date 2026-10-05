'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Undo,
  Redo,
  Maximize,
  Lock,
  Unlock,
  Play,
  Settings,
  ZoomIn,
  ZoomOut
} from 'lucide-react'

interface MobileToolbarProps {
  onAddClick: () => void
  onUndo: () => void
  onRedo: () => void
  onFitView: () => void
  onToggleLock: () => void
  onTestClick: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  isLocked: boolean
  canUndo: boolean
  canRedo: boolean
  currentZoom: number
  testLabel?: string
}

export function MobileToolbar({
  onAddClick,
  onUndo,
  onRedo,
  onFitView,
  onToggleLock,
  onTestClick,
  onZoomIn,
  onZoomOut,
  isLocked,
  canUndo,
  canRedo,
  currentZoom,
  testLabel = 'Test'
}: MobileToolbarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#1A1A1A] border-t border-[#3A3A3A] safe-area-bottom">
      <div className="flex items-center justify-between px-1 py-1.5">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddClick}
            disabled={isLocked}
            className={`h-9 w-9 p-0 rounded-full ${
              isLocked
                ? 'text-gray-600'
                : 'text-white bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Plus className="w-5 h-5" />
          </Button>

          <div className="w-px h-5 bg-[#3A3A3A] mx-0.5" />

          {/* Undo */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onUndo}
            disabled={!canUndo}
            className="h-9 w-9 p-0 text-gray-400 hover:text-white hover:bg-[#3A3A3A] disabled:opacity-30 rounded-full"
          >
            <Undo className="w-4 h-4" />
          </Button>

          {/* Redo */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRedo}
            disabled={!canRedo}
            className="h-9 w-9 p-0 text-gray-400 hover:text-white hover:bg-[#3A3A3A] disabled:opacity-30 rounded-full"
          >
            <Redo className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onZoomOut}
            className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded-full"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[10px] text-gray-400 min-w-[32px] text-center">
            {currentZoom}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onZoomIn}
            className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded-full"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Fit View */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onFitView}
            className="h-9 w-9 p-0 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded-full"
          >
            <Maximize className="w-4 h-4" />
          </Button>

          {/* Lock/Unlock */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleLock}
            className={`h-9 w-9 p-0 hover:bg-[#3A3A3A] rounded-full ${
              isLocked ? 'text-yellow-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </Button>

          <div className="w-px h-5 bg-[#3A3A3A] mx-0.5" />

          <Button
            variant="ghost"
            size="sm"
            onClick={onTestClick}
            className="h-9 px-3 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded-full font-medium text-sm"
          >
            <Play className="w-4 h-4 mr-1" />
            {testLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

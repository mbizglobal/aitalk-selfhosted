'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IconOptionButtonProps {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}

export function IconOptionButton({
  selected,
  onClick,
  children,
  className,
}: IconOptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative h-12 w-24 rounded-md overflow-hidden transition-all',
        selected
          ? 'border-2 border-primary ring-2 ring-primary/40'
          : 'border border-border hover:border-primary/40',
        className
      )}
    >
      {children}
      {selected && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  )
}

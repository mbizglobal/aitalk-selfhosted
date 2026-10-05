'use client'

import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import type { LimitType } from '../types'

interface LimitDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  limitType: LimitType
  t: Record<string, string>
}

export function LimitDialog({
  isOpen,
  onOpenChange,
  limitType,
  t,
}: LimitDialogProps) {
  const router = useRouter()

  const getTitle = () => {
    switch (limitType) {
      case 'workflow':
        return t.workflow_limit_title || 'Workflow Limit Reached'
      case 'datasheet':
        return t.datasheet_limit_title || 'Data Sheet Limit Reached'
      default:
        return t.workflow_deploy_limit_title
    }
  }

  const getMessage = () => {
    switch (limitType) {
      case 'workflow':
        return t.workflow_limit_message || 'Free users can create up to 10 workflows per agent. Upgrade to create unlimited workflows.'
      case 'datasheet':
        return t.datasheet_limit_message || 'Free users can create up to 2 data sheets per agent. Upgrade to create unlimited data sheets.'
      case 'free':
        return t.workflow_deploy_free_limit
      default:
        return t.workflow_deploy_paid_limit
    }
  }

  const showUpgradeButton = limitType === 'free' || limitType === 'workflow' || limitType === 'datasheet'

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            {getTitle()}
          </DialogTitle>
          <DialogDescription className="pt-2">
            {getMessage()}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.close_label}
          </Button>
          {showUpgradeButton && (
            <Button onClick={() => {
              onOpenChange(false)
              router.push('/app/subscription')
            }}>
              {t.workflow_deploy_upgrade}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

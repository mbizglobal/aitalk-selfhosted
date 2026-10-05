'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface MobileWarningDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  t: Record<string, string>
}

export function MobileWarningDialog({
  isOpen,
  onOpenChange,
  t,
}: MobileWarningDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.mobile_not_supported_title}</DialogTitle>
          <DialogDescription>
            {t.mobile_not_supported_message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {t.mobile_not_supported_ok}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

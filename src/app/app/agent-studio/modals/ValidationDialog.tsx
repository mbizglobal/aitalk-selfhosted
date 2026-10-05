'use client'

import React from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ValidationDialogProps {
  showValidationDialog: boolean
  setShowValidationDialog: (value: boolean) => void
  validationError: string | null
}

export function ValidationDialog({
  showValidationDialog,
  setShowValidationDialog,
  validationError
}: ValidationDialogProps) {
  return (
    <Dialog open={showValidationDialog} onOpenChange={setShowValidationDialog}>
      <DialogContent className="sm:max-w-[500px] bg-white">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold text-gray-900">
                Workflow Validation Failed
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 mt-1">
                Please resolve the issues below to activate the workflow.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="mt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800 leading-relaxed">
              {validationError}
            </p>
          </div>
        </div>
        <DialogFooter className="mt-6">
          <Button
            onClick={() => setShowValidationDialog(false)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
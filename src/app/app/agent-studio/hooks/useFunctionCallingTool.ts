
import { useState } from 'react'
import type { FunctionCallingToolConfig } from '../types'

export function useFunctionCallingTool() {
  const [functionDefinition, setFunctionDefinition] = useState<string>('')

  const validateFunctionDefinition = (definition: string): boolean => {
    try {
      const parsed = JSON.parse(definition)
      return parsed.name && parsed.description && parsed.parameters
    } catch {
      return false
    }
  }

  const resetFunctionCallingConfig = () => {
    setFunctionDefinition('')
  }

  const getFunctionCallingConfig = (): FunctionCallingToolConfig => ({
    definition: functionDefinition
  })

  return {
    // State
    functionDefinition,
    setFunctionDefinition,

    // Functions
    validateFunctionDefinition,
    resetFunctionCallingConfig,
    getFunctionCallingConfig
  }
}
'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Edition } from '@/lib/edition'

const EditionContext = createContext<Edition>('cloud')
const GoogleLoginContext = createContext<boolean>(true)
const FeedbackContext = createContext<boolean>(true)
const EeFeaturesContext = createContext<readonly string[]>([])

export function EditionProvider({ edition, googleLogin, feedback, eeFeatures, children }: { edition: Edition; googleLogin: boolean; feedback: boolean; eeFeatures: readonly string[]; children: ReactNode }) {
  return (
    <EditionContext.Provider value={edition}>
      <GoogleLoginContext.Provider value={googleLogin}>
        <FeedbackContext.Provider value={feedback}>
          <EeFeaturesContext.Provider value={eeFeatures}>{children}</EeFeaturesContext.Provider>
        </FeedbackContext.Provider>
      </GoogleLoginContext.Provider>
    </EditionContext.Provider>
  )
}

export function useEdition(): Edition {
  return useContext(EditionContext)
}

export function useGoogleLoginEnabled(): boolean {
  return useContext(GoogleLoginContext)
}

export function useFeedbackEnabled(): boolean {
  return useContext(FeedbackContext)
}

export function useEeFeature(feature: string): boolean {
  return useContext(EeFeaturesContext).includes(feature)
}

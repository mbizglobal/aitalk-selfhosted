'use client'

import { createContext, useContext } from 'react'

export const WorkPkg = createContext<string | null>(null)

export const useWorkPkg = () => useContext(WorkPkg)

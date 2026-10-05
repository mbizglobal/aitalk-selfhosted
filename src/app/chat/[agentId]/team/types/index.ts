export interface Message {
  id: string
  role: 'user' | 'assistant' | 'error' | 'system'
  content: string
  timestamp: Date
  attachments?: Array<{
    id: string
    name: string
    type: 'image' | 'pdf' | 'csv'
    previewUrl?: string
  }>
}

export interface ConversationItem {
  id: string
  title: string
  timestamp: Date
  updatedAt?: Date
}

export interface UploadedFile {
  id: string
  name: string
  type: 'image' | 'pdf' | 'csv'
  base64?: string
  text?: string
  size: number
  previewUrl?: string
  isFirstPage?: boolean
  totalPages?: number
}

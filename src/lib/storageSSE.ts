interface StorageSSEUpdate {
  type: 'file_upload_update' | 'google_drive_update'
  storageId: number
  agentId: string
  status: string
  message: string
  progress?: number
  error?: string
}

class StorageSSEManager {
  private sseClients = new Set<(update: StorageSSEUpdate) => void>()

  addSSEClient(callback: (update: StorageSSEUpdate) => void) {
    this.sseClients.add(callback)
  }

  removeSSEClient(callback: (update: StorageSSEUpdate) => void) {
    this.sseClients.delete(callback)
  }

  sendUpdate(update: StorageSSEUpdate) {
    this.sseClients.forEach(client => {
      try {
        client(update)
      } catch (error) {
        console.error('[STORAGE_SSE] Failed to send update:', error)
      }
    })
  }

  sendFileUploadUpdate(storageId: number, agentId: string, status: string, message: string, error?: string) {
    this.sendUpdate({
      type: 'file_upload_update',
      storageId,
      agentId,
      status,
      message,
      error
    })
  }

  sendGoogleDriveUpdate(storageId: number, agentId: string, status: string, message: string, error?: string) {
    this.sendUpdate({
      type: 'google_drive_update',
      storageId,
      agentId,
      status,
      message,
      error
    })
  }
}

const globalForStorageSSE = globalThis as unknown as {
  storageSSE: StorageSSEManager | undefined
}

export const storageSSE = globalForStorageSSE.storageSSE ?? new StorageSSEManager()

if (process.env.NODE_ENV !== 'production') {
  globalForStorageSSE.storageSSE = storageSSE
}

export interface DocIntelligenceResult {
  text: string
  pageCount: number
}

export function isBinaryFileType(mimeType: string): boolean {
  const binaryTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // xlsx
    'image/jpeg',  // OCR
    'image/png',   // OCR
  ]
  return binaryTypes.includes(mimeType)
}

export function isBinaryFileExtension(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png'].includes(ext || '')
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function extractTextFromBinary(
  fileBuffer: Buffer,
  endpoint: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<DocIntelligenceResult> {
  const apiVersion = '2024-11-30'
  const baseUrl = endpoint.replace(/\/+$/, '')

  const analyzeUrl = `${baseUrl}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${apiVersion}`

  const analyzeRes = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer as unknown as BodyInit,
    signal,
  })

  if (!analyzeRes.ok) {
    const errorText = await analyzeRes.text()
    throw new Error(`[DocIntelligence] Analyze request failed (${analyzeRes.status}): ${errorText}`)
  }

  const operationLocation = analyzeRes.headers.get('Operation-Location')
  if (!operationLocation) {
    throw new Error('[DocIntelligence] No Operation-Location header in response')
  }

  const maxAttempts = 60
  const pollInterval = 5000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await abortableSleep(pollInterval, signal)

    const resultRes = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal,
    })

    if (!resultRes.ok) {
      const errorText = await resultRes.text()
      throw new Error(`[DocIntelligence] Result polling failed (${resultRes.status}): ${errorText}`)
    }

    const result = await resultRes.json()

    if (result.status === 'succeeded') {
      const analyzeResult = result.analyzeResult
      const text = analyzeResult?.content || ''
      const pageCount = analyzeResult?.pages?.length || 0

      console.log(`[DocIntelligence] Extracted ${text.length} chars, ${pageCount} pages`)

      return { text, pageCount }
    }

    if (result.status === 'failed') {
      throw new Error(`[DocIntelligence] Analysis failed: ${JSON.stringify(result.error)}`)
    }

  }

  throw new Error('[DocIntelligence] Analysis timed out (5 minutes)')
}

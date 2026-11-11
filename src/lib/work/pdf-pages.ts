export const WORK_PDF_PAGE_LIMIT = 10
const WORK_PDF_PAGE_SCALE = 2
const WORK_PDF_PAGE_QUALITY = 0.92

const RENDER_TIMEOUT_MS = 60_000
const MAX_SIDE_PX = 4000

export async function renderPdfPages(buffer: Buffer, maxPages = WORK_PDF_PAGE_LIMIT, only?: readonly number[]): Promise<{ pages: number; images: Buffer[]; numbers: number[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('pdf render timeout')), RENDER_TIMEOUT_MS) })
  const run = (async () => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise
    try {
      const images: Buffer[] = []
      const list = only ? only.filter((n) => n >= 1 && n <= doc.numPages) : Array.from({ length: Math.min(doc.numPages, maxPages) }, (_, k) => k + 1)
      for (const i of list) {
        const page = await doc.getPage(i)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(WORK_PDF_PAGE_SCALE, MAX_SIDE_PX / Math.max(base.width, base.height, 1)) })
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise
        images.push(await canvas.encode('jpeg', Math.round(WORK_PDF_PAGE_QUALITY * 100)))
        page.cleanup()
      }
      return { pages: doc.numPages, images, numbers: list }
    } finally {
      await doc.destroy()
    }
  })()
  try {
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
  }
}

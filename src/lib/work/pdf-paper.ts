import { PDFDocument as PdfLibDocument, degrees } from 'pdf-lib'

export const A4 = { width: 595.28, height: 841.89 } as const
const TOLERANCE = 2

export async function checkPaper(bytes: Buffer): Promise<string | null> {
  let doc: PdfLibDocument
  try {
    doc = await PdfLibDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    if (e instanceof Error && /encrypt/i.test(e.message)) return 'the letterhead PDF is password-protected — save it without a password and upload again'
    return 'the letterhead file cannot be read as a PDF'
  }
  if (doc.isEncrypted) return 'the letterhead PDF is password-protected — save it without a password and upload again'
  const n = doc.getPageCount()
  if (n < 1 || n > 2) return 'the letterhead PDF must have 1 or 2 pages (first page, following pages)'
  for (const p of doc.getPages()) {
    const box = p.getCropBox()
    if (Math.abs(box.width - A4.width) > TOLERANCE || Math.abs(box.height - A4.height) > TOLERANCE) return 'the letterhead must be portrait A4 (210 × 297 mm)'
    if (p.getRotation().angle % 360 !== 0) return 'the letterhead page is rotated — save it as portrait A4 without rotation and upload again'
  }
  return null
}

export async function overlayPaper(front: Buffer, paper: Buffer, o: { title: string; author: string }): Promise<Buffer> {
  const out = await PdfLibDocument.create()
  out.setTitle(o.title)
  out.setAuthor(o.author)
  const lh = await PdfLibDocument.load(paper, { updateMetadata: false })
  const backs = await Promise.all(lh.getPages().map((p) => {
    const c = p.getCropBox()
    return out.embedPage(p, { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height })
  }))
  const src = await PdfLibDocument.load(front, { updateMetadata: false })
  const fronts = await out.embedPdf(src, src.getPageIndices())
  for (let i = 0; i < fronts.length; i++) {
    const f = fronts[i]
    const page = out.addPage([f.width, f.height])
    page.drawPage(backs[Math.min(i, backs.length - 1)], { x: 0, y: 0, width: f.width, height: f.height, rotate: degrees(0) })
    page.drawPage(f, { x: 0, y: 0 })
  }
  return Buffer.from(await out.save())
}

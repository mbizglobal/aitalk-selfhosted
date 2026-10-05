const CHUNK_SOFT_LIMIT = 1500
const CHUNK_HARD_LIMIT = 2000
const CHUNK_OVERLAP = 200

export function chunkText(text: string): string[] {
  const chunks: string[] = []

  const sections = splitBySections(text)

  let currentChunk = ''

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    const isNewSection = /^#{1,6}\s|^[-*]{3,}\s*$/.test(trimmed.split('\n')[0])

    if (isNewSection && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = ''
    }

    if (currentChunk.length + trimmed.length + 2 <= CHUNK_SOFT_LIMIT) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
      continue
    }

    if (currentChunk.length + trimmed.length + 2 <= CHUNK_HARD_LIMIT && !isNewSection) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
      continue
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = ''
    }

    if (trimmed.length <= CHUNK_HARD_LIMIT) {
      currentChunk = trimmed
      continue
    }

    splitLargeSection(trimmed, chunks, (remaining) => { currentChunk = remaining })
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk)
  }

  return chunks.filter(c => c.trim().length > 0)
}

function splitBySections(text: string): string[] {
  const lines = text.split('\n')
  const sections: string[] = []
  let currentSection: string[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()

    const isHeading = /^#{1,6}\s/.test(trimmedLine)
    const isDivider = /^[-*]{3,}\s*$/.test(trimmedLine) && trimmedLine.length >= 3

    if ((isHeading || isDivider) && currentSection.length > 0) {
      sections.push(currentSection.join('\n'))
      currentSection = []
    }

    if (isDivider) continue

    currentSection.push(line)
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n'))
  }

  return sections
}

function splitLargeSection(
  text: string,
  chunks: string[],
  setRemaining: (remaining: string) => void
): void {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  let currentChunk = ''

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()

    if (currentChunk.length + trimmed.length + 2 <= CHUNK_SOFT_LIMIT) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
      continue
    }

    if (currentChunk.length + trimmed.length + 2 <= CHUNK_HARD_LIMIT) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
      continue
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = ''
    }

    if (trimmed.length <= CHUNK_HARD_LIMIT) {
      currentChunk = trimmed
      continue
    }

    splitBySentences(trimmed, chunks, (remaining) => { currentChunk = remaining })
  }

  setRemaining(currentChunk)
}

function splitBySentences(
  text: string,
  chunks: string[],
  setRemaining: (remaining: string) => void
): void {
  const sentences = text.split(/(?<=[.!?。！？\n])\s+/)
  let currentChunk = ''

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 <= CHUNK_SOFT_LIMIT) {
      currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence
    } else if (currentChunk.length + sentence.length + 1 <= CHUNK_HARD_LIMIT) {
      currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence
    } else {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
      }
      if (sentence.length > CHUNK_HARD_LIMIT) {
        let start = 0
        while (start < sentence.length) {
          const end = Math.min(start + CHUNK_SOFT_LIMIT, sentence.length)
          chunks.push(sentence.substring(start, end))
          start += CHUNK_SOFT_LIMIT - CHUNK_OVERLAP
          if (start >= sentence.length) break
        }
        currentChunk = ''
      } else {
        currentChunk = sentence
      }
    }
  }

  setRemaining(currentChunk)
}

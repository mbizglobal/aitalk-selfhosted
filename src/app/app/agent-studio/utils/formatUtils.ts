
export function formatPayloadPreview(data: any): string {
  try {
    const json = JSON.stringify(data, null, 2)
    const limit = 1500
    if (json.length > limit) {
      return `${json.slice(0, limit)}\n...\n(truncated, click to view full payload)`
    }
    return json
  } catch (error) {
    return '[Unable to display payload]'
  }
}
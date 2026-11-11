export function stripCitationMarks(text: string): string {
  if (!/[-]/.test(text)) return text
  return text
    .replace(/[^]*/g, '')
    .replace(/[^]*$/, '')
    .replace(/[-]/g, '')
    .replace(/[ \t]+$/gm, '')
}

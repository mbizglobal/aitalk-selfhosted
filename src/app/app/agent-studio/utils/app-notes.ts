import { toast } from 'sonner'

export function showAppNotes(notes: unknown, t: Record<string, string>): void {
  if (!Array.isArray(notes)) return
  for (const n of notes as Array<{ code?: unknown; label?: unknown; nodeId?: unknown }>) {
    if (n?.code !== 'APP_NEW_PROJECT') continue
    const label = typeof n.label === 'string' && n.label ? n.label : String(n.nodeId ?? '')
    toast.warning((t.work_app_note_new_project || '“{app}” came back with a new, empty project — its earlier data now belongs to another work app.').replace('{app}', label), {
      id: `app-note-${String(n.nodeId ?? '')}`, duration: Infinity, closeButton: true,
    })
  }
}

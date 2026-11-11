
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'
import { readSheetScreen } from '@/lib/work/views'
import { evidenceOf, pageQuery } from '@/lib/work/sheet-page-query'
import { appSheetView, webScreenRows } from '@/lib/work/sheet-app'
import { appLang } from '@/lib/work/app-screen'
import { isProjectDetached } from '@/lib/work/sheet-gate'
import { packageOfKind } from '@/lib/translations/work'

export const GET = workRoute<{ agentId: string; projectId: string; sheetId: string }>('sheet.read', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const sp = req.nextUrl.searchParams
  const page = pageQuery(sp)
  const screen = await readSheetScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, page })
  if (sp.get('app') !== '1') return screen
  const proj = await deps.db.workProject.findFirst({ where: { id: p.projectId, userId: access.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
  const lang = appLang(sp.get('lang'))
  const pkg = packageOfKind(proj?.kind)
  const readOnly = !proj || proj.status !== 'active' || isProjectDetached(proj)
  const all = [...screen.rows, ...(screen.screenRows?.virtual ?? []).map((v) => ({ id: `virtual:${v.key}`, data: v.data, confirmed: false, confirmedByAi: false, locked: true, updatedAt: new Date(0), virtual: true as const }))]
  const list = webScreenRows(lang, pkg, screen, all, { period: page.period, showHidden: page.showHidden, evidence: evidenceOf(sp), sort: page.sort ?? null })
  return { ...screen, app: { readOnly, ...appSheetView(lang, pkg, readOnly, screen, list, screen.derived?.cells ?? {}, { screen: true }) } }
})

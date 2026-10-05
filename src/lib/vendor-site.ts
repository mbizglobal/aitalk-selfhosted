export type SalesWidget = { hostname: string; agentId: string; workflowId: string }
export const VENDOR_SALES_WIDGET: { dev: SalesWidget; prod: SalesWidget } | null = null
export const VENDOR_DEV_HOSTS: readonly string[] = []

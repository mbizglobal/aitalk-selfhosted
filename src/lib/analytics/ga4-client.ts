// GA4 Measurement Protocol Client

import { GA4Event, AnalyticsConfig } from './types'

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect'
const GA4_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect'

export async function sendGA4Event(
  config: AnalyticsConfig,
  clientId: string,
  events: GA4Event[],
  debug = false
): Promise<{ success: boolean; error?: string; validationMessages?: any[] }> {
  if (!config.isEnabled) {
    return { success: false, error: 'Analytics is disabled' }
  }

  if (!config.measurementId || !config.apiSecret) {
    return { success: false, error: 'Invalid analytics configuration' }
  }

  const endpoint = debug ? GA4_DEBUG_ENDPOINT : GA4_ENDPOINT

  try {
    const response = await fetch(
      `${endpoint}?measurement_id=${config.measurementId}&api_secret=${config.apiSecret}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          events: events.map(e => ({
            name: e.name,
            params: {
              ...e.params,
              engagement_time_msec: 100,
            }
          }))
        })
      }
    )

    if (debug) {
      const data = await response.json()
      return {
        success: data.validationMessages?.length === 0,
        validationMessages: data.validationMessages
      }
    }

    return { success: response.ok }
  } catch (error) {
    console.error('[GA4] Failed to send event:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

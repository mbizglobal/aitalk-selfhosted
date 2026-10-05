
export const FUNCTION_EXAMPLES = [
  {
    name: 'get_eur_usd_exchange',
    label: 'get_eur_usd_exchange()',
    definition: {
      name: 'get_eur_usd_exchange',
      description: 'Get the current EUR to USD exchange rate',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'Amount in EUR to convert'
          }
        },
        additionalProperties: false,
        required: ['amount']
      }
    }
  },
  {
    name: 'get_premier_league_results',
    label: 'get_premier_league_results()',
    definition: {
      name: 'get_premier_league_results',
      description: 'Get recent Premier League match results',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'Team name (e.g. Manchester United, Liverpool)'
          },
          matchday: {
            type: 'number',
            description: 'Specific matchday number (1-38)'
          }
        },
        additionalProperties: false,
        required: ['team']
      }
    }
  }
]
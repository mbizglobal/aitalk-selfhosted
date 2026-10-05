import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError, describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    const microsoftAccount = await prisma.account.findFirst({
      where: {
        userId: agent.userId,
        provider: 'microsoft'
      }
    })

    if (!microsoftAccount || !microsoftAccount.access_token) {
      return NextResponse.json(
        { error: 'SharePoint not connected' },
        { status: 401 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    let currentAccessToken = microsoftAccount.access_token

    if (microsoftAccount.expires_at && microsoftAccount.expires_at <= now) {
      if (!microsoftAccount.refresh_token) {
        return NextResponse.json(
          { error: 'Token expired and no refresh token available' },
          { status: 401 }
        )
      }

      try {
        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID!,
            client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
            refresh_token: microsoftAccount.refresh_token,
            grant_type: 'refresh_token',
          }),
        })

        if (!tokenResponse.ok) {
          console.error('Token refresh failed:', describeUpstreamError(tokenResponse.status, await tokenResponse.text()))
          return NextResponse.json(
            { error: 'Failed to refresh token' },
            { status: 401 }
          )
        }

        const tokenData = await readUpstreamJson(tokenResponse)
        currentAccessToken = tokenData.access_token

        await prisma.account.update({
          where: {
            provider_providerAccountId: {
              provider: 'microsoft',
              providerAccountId: microsoftAccount.providerAccountId
            }
          },
          data: {
            access_token: tokenData.access_token,
            expires_at: tokenData.expires_in ? Math.floor(Date.now() / 1000) + tokenData.expires_in : null,
            refresh_token: tokenData.refresh_token || microsoftAccount.refresh_token,
          }
        })
      } catch (refreshError) {
        console.error('Token refresh failed:', describeCaughtError(refreshError))
        return NextResponse.json(
          { error: 'Failed to refresh token' },
          { status: 401 }
        )
      }
    }

    const sitesResponse = await fetch('https://graph.microsoft.com/v1.0/sites?search=*', {
      headers: {
        'Authorization': `Bearer ${currentAccessToken}`,
        'Accept': 'application/json'
      }
    })

    let sites: any[] = []
    const siteIds = new Set<string>()

    if (sitesResponse.ok) {
      const sitesData = await readUpstreamJson(sitesResponse)
      if (sitesData.value && sitesData.value.length > 0) {
        sites = sitesData.value.map((site: any) => {
          siteIds.add(site.id)
          return {
            id: site.id,
            name: site.displayName || site.name,
            webUrl: site.webUrl,
            description: site.description,
            createdDateTime: site.createdDateTime,
            lastModifiedDateTime: site.lastModifiedDateTime
          }
        })
      }
    }

    try {
      const groupsResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.group?$filter=groupTypes/any(c:c eq 'Unified')&$select=id,displayName,description`,
        {
          headers: {
            'Authorization': `Bearer ${currentAccessToken}`,
            'Accept': 'application/json'
          }
        }
      )

      if (groupsResponse.ok) {
        const groupsData = await readUpstreamJson(groupsResponse)
        if (groupsData.value && groupsData.value.length > 0) {
          const sitePromises = groupsData.value.map(async (group: any) => {
            try {
              const siteResponse = await fetch(
                `https://graph.microsoft.com/v1.0/groups/${group.id}/sites/root`,
                {
                  headers: {
                    'Authorization': `Bearer ${currentAccessToken}`,
                    'Accept': 'application/json'
                  }
                }
              )
              if (siteResponse.ok) {
                return await readUpstreamJson(siteResponse)
              }
            } catch {
            }
            return null
          })

          const groupSites = await Promise.all(sitePromises)
          for (const site of groupSites) {
            if (site && !siteIds.has(site.id)) {
              siteIds.add(site.id)
              sites.push({
                id: site.id,
                name: site.displayName || site.name,
                webUrl: site.webUrl,
                description: site.description,
                createdDateTime: site.createdDateTime,
                lastModifiedDateTime: site.lastModifiedDateTime
              })
            }
          }
        }
      }
    } catch (fallbackError) {
      console.error('Group-based site enumeration failed:', describeCaughtError(fallbackError))
    }

    try {
      const driveResponse = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
        headers: {
          'Authorization': `Bearer ${currentAccessToken}`,
          'Accept': 'application/json'
        }
      })

      if (driveResponse.ok) {
        const driveData = await readUpstreamJson(driveResponse)
        const personalEntry = {
          id: 'onedrive',
          name: 'My Files (OneDrive)',
          webUrl: driveData.webUrl,
          description: 'Your personal OneDrive storage',
          createdDateTime: driveData.createdDateTime,
          lastModifiedDateTime: driveData.lastModifiedDateTime,
          driveId: driveData.id
        }

        if (sites.length === 0) {
          sites = [personalEntry]
        } else {
          sites.unshift(personalEntry)
        }
      } else {
        const errorText = await driveResponse.text()
        console.error('Failed to fetch OneDrive:', describeUpstreamError(driveResponse.status, errorText))

        try {
          const errorData = JSON.parse(errorText)
          if (errorData.error?.message?.includes('SPO license') ||
              errorData.error?.message?.includes('does not have a SPO')) {
            return NextResponse.json(
              {
                error: 'NO_SPO_LICENSE',
                message: 'This Microsoft account does not have a SharePoint Online license.'
              },
              { status: 403 }
            )
          }
        } catch {
        }
      }
    } catch (driveError) {
      console.error('Error while loading OneDrive info:', describeCaughtError(driveError))
      if (sites.length === 0) {
        return NextResponse.json(
          { error: 'Failed to fetch SharePoint sites or OneDrive' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        sites
      }
    })

  } catch (error) {
    console.error('Failed to fetch SharePoint sites:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to fetch SharePoint sites' },
      { status: 500 }
    )
  }
}

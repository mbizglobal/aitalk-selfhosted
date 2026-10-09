import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { hasAnyApiKey } from '@/lib/ai-providers/get-api-key';
import { isPaymentConvertedForUser } from '@/lib/entitlement';
import { deriveAccountLifecycle } from '@/lib/subscription/lifecycle';
import { isSelfHosted } from '@/lib/edition';
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy';
import { pricingPlans, managedPricingPlans } from '@/lib/translations';
import {
  CPA_PER_VOICE_MINUTE,
  CPA_PER_REALTIME_VOICE_MINUTE,
  getRealtimeCPAPerMinute,
} from '@/lib/managed/cost';

export async function GET() {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'dashboard_api_unauthorized' }, { status: 401 });
    }

    const selfHosted = isSelfHosted();

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        last_login_at: true,
        encryptedDataKey: true,
        settings: {
          select: {
            plan: true,
            time_format: true,
            locale: true,
          }
        },
        aiProviders: {
          select: {
            id: true,
            providers: true,
            defaultProvider: true,
          }
        },
        subscription: selfHosted ? false : {
          select: {
            start_date: true,
            end_date: true,
            free_cpa: true,
            free_total: true,
            paid_cpa: true,
            paid_total: true,
            month: true,
            num_assistant: true,
            planType: true,
            billingCycle: true,
            status: true,
            platform: true,
            serviceVariant: true,
            managedRegion: true,
            storagePerAgent: true,
            cpaResetDate: true,
            booster_cpa: true,
            booster_total: true,
            booster_expires_at: true,
            trialEndsAt: true,
            graceStartedAt: true,
            softFreeConvertedAt: true,
            partnerId: true,
          }
        },
        cpaLedger: {
          select: {
            cpa_amount: true,
            paymentStatus: true,
            platform: true,
            transactionType: true,
            currency: true
          },
          orderBy: {
            created_at: 'desc'
          },
          take: 5
        }
      }
    });

    let downgradeSchedule = null;
    if (user?.subscription?.platform === 'manual_invoice') {
      downgradeSchedule = await prisma.invoicePlanChangeSchedule.findUnique({
        where: {
          userId: session.user.id,
        },
        select: {
          newPlanType: true,
          newBillingCycle: true,
          scheduledDate: true,
          status: true
        }
      });

      if (downgradeSchedule?.status !== 'pending') {
        downgradeSchedule = null;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'dashboard_api_user_not_found' }, { status: 404 });
    }

    const plan = user.settings?.plan || 'free';
    const normalizedPlan = plan.toLowerCase();
    const isManaged = user.subscription?.serviceVariant === 'managed';
    const apiKeyConfigured = isManaged ? true : hasAnyApiKey(user as any);

    let cpa_available = 0;
    let cpa_total = 0;
    let has_cpa_data = false;

    if (normalizedPlan.includes('free')) {
      if (user.subscription) {
        cpa_available = user.subscription.free_cpa ?? user.subscription.free_total ?? 0;
        cpa_total = user.subscription.free_total ?? 50;
        has_cpa_data = true;
      } else {
        cpa_available = 50;
        cpa_total = 50;
      }
    } else {
      const planCredits = (isManaged ? managedPricingPlans : pricingPlans)
        .find(p => p.id === normalizedPlan)?.messagesPerMonth;

      cpa_available = user.subscription?.paid_cpa ?? 0;
      cpa_total = user.subscription?.paid_total ?? planCredits ?? 0;
      has_cpa_data = user.subscription?.paid_cpa !== undefined;
    }

    const sub = user.subscription;
    let isTrial = false;
    let trialConverted = false;
    if (sub?.trialEndsAt) {
      trialConverted = await isPaymentConvertedForUser(session.user.id, sub.status, sub.planType);
      if (sub.status === 'active' && (sub.planType || 'free') !== 'free') {
        isTrial = !trialConverted;
      }
    }

    const lifecycle = sub
      ? deriveAccountLifecycle(sub, { isConverted: trialConverted })
      : { state: 'active' as const, dataDeletionDate: null, previousPlan: null };

    let partnerName: string | null = null;
    if (sub?.partnerId) {
      const partner = await prisma.partner.findUnique({
        where: { id: sub.partnerId },
        select: { contactName: true },
      });
      partnerName = partner?.contactName ?? null;
    }

    const latestPaymentStatus = user.cpaLedger?.[0]?.paymentStatus || null;
    const invoiceUserCurrency = user.cpaLedger?.find(
      ledger => ledger.platform === 'manual_invoice' && ledger.currency
    )?.currency || null;

    let pendingInvoice = null;
    if (user.subscription?.platform === 'manual_invoice') {
      const latestPendingInvoice = await prisma.invoice.findFirst({
        where: {
          userId: session.user.id,
          status: 'sent',
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          currency: true,
          planType: true,
          dueDate: true,
          createdAt: true,
          notes: true,
          invoiceType: true,
        }
      });
      pendingInvoice = latestPendingInvoice;
    }

    const [mcpTokenCount, mcpLastUsedToken] = await Promise.all([
      prisma.mcpAccessToken.count({ where: { userId: session.user.id, revokedAt: null } }),
      prisma.mcpAccessToken.findFirst({
        where: { userId: session.user.id, revokedAt: null, lastUsedAt: { not: null } },
        orderBy: { lastUsedAt: 'desc' },
        select: { name: true, lastUsedAt: true, lastUsedIp: true, lastUsedCountry: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        email: user.email,
        last_login_at: user.last_login_at,
        plan: plan,
        time_format: user.settings?.time_format || 'DD.MM.YYYY HH:mm',
        locale: user.settings?.locale || 'en-US',
        api_key_configured: apiKeyConfigured,
        num_assistant: selfHosted ? SELF_HOSTED_POLICY.agentLimit : (user.subscription?.num_assistant || 1),
        service_period: user.subscription ? {
          start_date: user.subscription.start_date,
          end_date: user.subscription.end_date
        } : null,
        isTrial,
        trialEndsAt: user.subscription?.trialEndsAt?.toISOString() ?? null,
        lifecycle,
        partnerName,
        mcp: {
          token_count: mcpTokenCount,
          last_used_at: mcpLastUsedToken?.lastUsedAt ?? null,
          last_used_ip: mcpLastUsedToken?.lastUsedIp ?? null,
          last_used_country: mcpLastUsedToken?.lastUsedCountry ?? null,
          last_used_token_name: mcpLastUsedToken?.name ?? null,
        },
        cpa_data: {
          available: cpa_available,
          total: cpa_total,
          has_data: has_cpa_data,
          voice_minutes: normalizedPlan.includes('free') ? null : {
            chat: Math.floor((cpa_available + (user.subscription?.booster_cpa ?? 0)) / CPA_PER_VOICE_MINUTE),
            realtime: isManaged
              ? Math.floor((cpa_available + (user.subscription?.booster_cpa ?? 0)) / CPA_PER_REALTIME_VOICE_MINUTE)
              : null,
            realtime_mini: isManaged
              ? Math.floor((cpa_available + (user.subscription?.booster_cpa ?? 0)) / getRealtimeCPAPerMinute('gpt-realtime-2.1-mini'))
              : null,
          },
        },
        booster_data: user.subscription?.serviceVariant === 'managed' ? {
          eligible: user.subscription.status === 'active' && normalizedPlan !== 'free',
          balance: user.subscription?.booster_cpa ?? 0,
          total: user.subscription?.booster_total ?? 0,
          expiresAt: user.subscription?.booster_expires_at?.toISOString() ?? null,
        } : null,
        paid_total: user.subscription?.paid_total ?? 0,
        planType: user.subscription?.planType || 'free',
        billingCycle: user.subscription?.billingCycle || 'monthly',
        status: user.subscription?.status || 'active',
        platform: user.subscription?.platform || null,
        serviceVariant: user.subscription?.serviceVariant || 'self',
        managedRegion: user.subscription?.managedRegion || null,
        storagePerAgent: user.subscription?.storagePerAgent || null,
        cpaResetDate: user.subscription?.cpaResetDate || null,
        paymentStatus: latestPaymentStatus,
        invoiceUserCurrency,
        pendingInvoice: pendingInvoice ? (() => {
          let noteServiceVariant: string | null = null;
          let noteManagedRegion: string | null = null;
          if (pendingInvoice.notes) {
            try {
              const parsed = JSON.parse(pendingInvoice.notes);
              if (parsed.serviceVariant) noteServiceVariant = parsed.serviceVariant;
              if (parsed.managedRegion) noteManagedRegion = parsed.managedRegion;
            } catch {}
          }
          return {
            id: pendingInvoice.id,
            invoiceNumber: pendingInvoice.invoiceNumber,
            totalAmount: Number(pendingInvoice.totalAmount),
            currency: pendingInvoice.currency,
            planType: pendingInvoice.planType,
            dueDate: pendingInvoice.dueDate,
            serviceVariant: noteServiceVariant,
            managedRegion: noteManagedRegion,
          };
        })() : null,
        downgradeSchedule: downgradeSchedule ? {
          newPlanType: downgradeSchedule.newPlanType,
          newBillingCycle: downgradeSchedule.newBillingCycle,
          scheduledDate: downgradeSchedule.scheduledDate
        } : null
      }
    });

  } catch (error) {
    return NextResponse.json({
      error: 'dashboard_api_failed_to_fetch_user_info'
    }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { reconcileWithLock } from '@/lib/calendar/booking-sync-lock';
import { userHasCalendarNode } from '@/lib/calendar/bookings-view';

async function hasCalendarNode(userId: string): Promise<boolean> {
  try {
    return await userHasCalendarNode(prisma, userId);
  } catch (e) {
    console.error('[bookings-stats] hasCalendar lookup failed', e);
    return false;
  }
}

async function computeStats(userId: string) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in15d = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const confirmed = { userId, status: 'confirmed' as const };

  const [upH24, upD7, upD15, newH24, newD7] = await Promise.all([
    prisma.bookingIndex.count({ where: { ...confirmed, startAt: { gt: now, lte: in24h } } }),
    prisma.bookingIndex.count({ where: { ...confirmed, startAt: { gt: now, lte: in7d } } }),
    prisma.bookingIndex.count({ where: { ...confirmed, startAt: { gt: now, lte: in15d } } }),
    prisma.bookingIndex.count({ where: { ...confirmed, createdAt: { gte: past24h } } }),
    prisma.bookingIndex.count({ where: { ...confirmed, createdAt: { gte: past7d } } }),
  ]);

  const hasData = upD15 > 0 || newD7 > 0;

  return {
    hasData,
    upcoming: { h24: upH24, d7: upD7, d15: upD15 },
    created: { h24: newH24, d7: newD7 },
  };
}

export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'dashboard_api_unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const [stats, hasCalendar] = await Promise.all([computeStats(userId), hasCalendarNode(userId)]);
    return NextResponse.json({ ...stats, hasCalendar });
  } catch (e) {
    console.error('[bookings-stats] GET failed', e);
    return NextResponse.json({ error: 'bookings_stats_failed' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'dashboard_api_unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { synced, inProgress } = await reconcileWithLock(prisma, userId);
    const [stats, hasCalendar] = await Promise.all([computeStats(userId), hasCalendarNode(userId)]);
    return NextResponse.json({ ...stats, hasCalendar, synced, ...(inProgress ? { inProgress: true } : {}) });
  } catch (e) {
    console.error('[bookings-stats] POST failed', e);
    return NextResponse.json({ error: 'bookings_stats_failed' }, { status: 500 });
  }
}

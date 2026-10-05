
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLocalCategories } from '@/lib/local-templates';
import { describeCaughtError } from '@/lib/log-mask';
import { VENDOR_DEV_HOSTS } from '@/lib/vendor-site';

const DEV_HOSTS = [...VENDOR_DEV_HOSTS, 'localhost', '127.0.0.1'];

function isDevServer(request: NextRequest): boolean {
  const host = request.headers.get('host') || '';
  return DEV_HOSTS.some(devHost => host.includes(devHost));
}

export async function GET(request: NextRequest) {
  try {
    if (isDevServer(request)) {
      const localCategories = getLocalCategories();

      const categories = localCategories.map(c => ({
        code: c.code,
        name: c.name,
        description: c.description,
      }));

      return NextResponse.json({ categories, source: 'local' });
    }

    const categories = await prisma.wfTemplateCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        name: true,
        description: true,
      },
    });

    return NextResponse.json({ categories, source: 'database' });
  } catch (error) {
    console.error('Get categories error:', describeCaughtError(error));
    return NextResponse.json(
      { error: 'Failed to get categories' },
      { status: 500 }
    );
  }
}

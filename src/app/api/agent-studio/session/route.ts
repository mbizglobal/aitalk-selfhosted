
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
  createSession,
  getSession,
  deleteSession,
  getSessionByWorkflow,
} from '@/lib/ai-assistant/session-service';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workflowId, provider, model } = body;

    const existingSessionId = await getSessionByWorkflow(
      session.user.id,
      workflowId || null
    );

    if (existingSessionId) {
      const existingSession = await getSession(existingSessionId);
      return NextResponse.json({
        success: true,
        sessionId: existingSessionId,
        isNew: false,
        messageCount: existingSession?.messages.length || 0,
      });
    }

    const sessionId = await createSession(
      session.user.id,
      workflowId,
      provider,
      model
    );

    return NextResponse.json({
      success: true,
      sessionId,
      isNew: true,
      messageCount: 0,
    });
  } catch (error) {
    console.error('[Session API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const aiSession = await getSession(sessionId);

    if (!aiSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (aiSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      session: aiSession,
    });
  } catch (error) {
    console.error('[Session API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const aiSession = await getSession(sessionId);
    if (!aiSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (aiSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await deleteSession(sessionId);

    return NextResponse.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error) {
    console.error('[Session API] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}

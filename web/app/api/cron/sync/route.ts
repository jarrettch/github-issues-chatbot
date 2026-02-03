import { NextResponse } from 'next/server';
import { syncIssues } from '@/lib/sync';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncIssues();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Sync failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

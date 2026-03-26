import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') ?? 'csv'; // 'csv' | 'json'
  const type = req.nextUrl.searchParams.get('type') ?? 'jobs'; // 'jobs' | 'leaks' | 'notifications'
  const cursor = req.nextUrl.searchParams.get('cursor') ?? null;
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '500'), 500);

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id;

  let query;
  let filename: string;

  if (type === 'leaks') {
    query = supabase
      .from('reconciliation_results')
      .select('id, job_id, status, estimated_leak_cents, created_at, jobs(crm_job_id, customer_name, address)')
      .eq('tenant_id', tenantId)
      .in('status', ['discrepancy', 'frozen'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (cursor) {
      query = query.lt('created_at', cursor);
    }
    filename = `leaklock-leaks-${new Date().toISOString().split('T')[0]}`;
  } else if (type === 'notifications') {
    query = supabase
      .from('notification_logs')
      .select('id, job_id, channel, status, sent_at, error_msg')
      .eq('tenant_id', tenantId)
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (cursor) {
      query = query.lt('sent_at', cursor);
    }
    filename = `leaklock-notifications-${new Date().toISOString().split('T')[0]}`;
  } else {
    // Default: jobs
    query = supabase
      .from('jobs')
      .select('id, crm_job_id, customer_name, address, status, created_at, scheduled_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (cursor) {
      query = query.lt('created_at', cursor);
    }
    filename = `leaklock-jobs-${new Date().toISOString().split('T')[0]}`;
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No data found' }, { status: 404 });
  }

  // Cursor for the next page: present only when the page is full (more may exist)
  const lastItem = data[data.length - 1] as Record<string, unknown>;
  const nextCursor = data.length === limit
    ? String(lastItem.created_at ?? lastItem.sent_at ?? '')
    : null;

  const truncated = data.length >= limit;
  const truncationHeaders: Record<string, string> = truncated
    ? { 'X-Truncated': 'true', 'X-Truncated-At': String(data.length) }
    : {};

  const paginationHeaders: Record<string, string> = {
    'X-Page-Size': String(data.length),
    ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}),
  };

  if (format === 'json') {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}.json"`,
        ...truncationHeaders,
        ...paginationHeaders,
      },
    });
  }

  // CSV export
  const rows = data as Record<string, unknown>[];
  const headers = Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ];
  const csv = csvLines.join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
      ...truncationHeaders,
      ...paginationHeaders,
    },
  });
}

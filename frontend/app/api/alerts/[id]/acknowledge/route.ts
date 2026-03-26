import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  _req: NextRequest,
  context: RouteContext,
) {
  const { id } = await context.params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = user.user_metadata?.tenant_id ?? user.app_metadata?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const { error } = await supabase
    .from("alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

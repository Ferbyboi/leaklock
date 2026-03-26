import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { job_id?: string; text?: string; location_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { job_id, text, location_id } = body;

  if (!job_id || typeof job_id !== "string") {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  if (!text || typeof text !== "string" || text.trim().length < 3) {
    return NextResponse.json(
      { error: "text must be at least 3 characters" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("field_events")
    .insert({
      job_id,
      location_id: location_id ?? null,
      user_id: user.id,
      event_type: "text",
      transcript: text,
      compliance_status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

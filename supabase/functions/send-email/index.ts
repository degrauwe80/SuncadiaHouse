// Supabase Edge Function: send-email
// Sends transactional emails via Mailgun to all app users.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   MAILGUN_API_KEY  — Mailgun API key (starts with "key-...")
//   MAILGUN_DOMAIN   — Mailgun sending domain (e.g. mg.yourdomain.com)
//   MAILGUN_FROM     — Sender string (e.g. "SunEscape <noreply@mg.yourdomain.com>")
//
// Deploy: supabase functions deploy send-email

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore-file no-explicit-any
declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY") ?? "";
    const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN") ?? "";
    const MAILGUN_FROM =
      Deno.env.get("MAILGUN_FROM") ?? `SunEscape <noreply@${MAILGUN_DOMAIN}>`;

    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      return new Response(
        JSON.stringify({ error: "Mailgun not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { subject, html, text, excludeUserId, targetUserId } = await req.json();

    // Fetch user emails using service-role key (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let query = supabase
      .from("profiles")
      .select("email")
      .not("email", "is", null);

    if (targetUserId) {
      // Send only to a specific user (e.g. join-request notifications)
      query = query.eq("id", targetUserId);
    } else if (excludeUserId) {
      query = query.neq("id", excludeUserId);
    }

    const { data: profiles, error } = await query;
    if (error) throw error;

    const recipients: string[] = (profiles ?? [])
      .map((p: any) => p.email as string)
      .filter(Boolean);

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No recipients" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mailgun API — send to each recipient individually to avoid exposing
    // addresses to each other.
    const results = await Promise.allSettled(
      recipients.map(async (to) => {
        const body = new URLSearchParams({
          from: MAILGUN_FROM,
          to,
          subject,
          html: html ?? "",
          text: text ?? "",
        });

        const res = await fetch(
          `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Mailgun error for ${to}: ${res.status} ${text}`);
        }
        return res.json();
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - sent;

    return new Response(
      JSON.stringify({ sent, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

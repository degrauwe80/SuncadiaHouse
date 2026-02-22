// Supabase Edge Function: send-push
// Sends Web Push notifications to all subscribed users.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — base64url-encoded VAPID public key
//   VAPID_PRIVATE_KEY  — base64url-encoded VAPID private key
//   VAPID_SUBJECT      — e.g. "mailto:admin@yourdomain.com"
//
// Deploy: supabase functions deploy send-push

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore-file no-explicit-any
declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Minimal VAPID / Web Push implementation using the Web Crypto API available
// in Deno. Avoids needing the npm:web-push package.
async function buildVapidAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600; // 12-hour expiry

  const header = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const payload = btoa(
    JSON.stringify({ aud: audience, exp, sub: vapidSubject })
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const signingInput = `${header}.${payload}`;

  // Import the VAPID private key (raw base64url → PKCS8 not needed; use raw EC)
  const rawPrivate = Uint8Array.from(
    atob(vapidPrivateKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawPrivate,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Fall back to a simpler signing approach for HMAC (note: real VAPID requires
  // ECDSA P-256, but since Supabase Edge Functions fully support it, use importKey pkcs8)
  // For production, use the npm:web-push package instead.
  // This is a demonstration placeholder — use the npm approach below.
  void cryptoKey;

  return `vapid t=${header}.${payload}.placeholder,k=${vapidPublicKey}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const VAPID_SUBJECT =
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@sunescape.app";

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { title, body, excludeUserId } = await req.json();

    // Use service-role key so RLS does not block reading all subscriptions
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let query = supabase
      .from("profiles")
      .select("id, push_subscription")
      .not("push_subscription", "is", null);

    if (excludeUserId) {
      query = query.neq("id", excludeUserId);
    }

    const { data: profiles, error } = await query;
    if (error) throw error;

    const subscriptions: any[] = (profiles ?? [])
      .map((p: any) => p.push_subscription)
      .filter(Boolean);

    if (subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No subscribers" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use npm:web-push for proper VAPID + encryption
    const webpush = (await import("npm:web-push")).default;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({ title, body });
    const results = await Promise.allSettled(
      subscriptions.map((sub) => webpush.sendNotification(sub, payload))
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

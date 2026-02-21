// Copy this file to config.js and fill in your credentials.
// config.js is intentionally NOT committed to version control.
//
// ── Supabase ─────────────────────────────────────────────────
// Find these in: Supabase Dashboard → Settings → API
window.SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
window.SUPABASE_ANON_KEY = "your-anon-public-key";

// ── Web Push (VAPID) ─────────────────────────────────────────
// Generate a VAPID key pair once:
//   npx web-push generate-vapid-keys
// Then:
//   - Put the PUBLIC key here (safe to expose in client)
//   - Store PRIVATE key + other secrets in Supabase Edge Functions:
//       supabase secrets set VAPID_PRIVATE_KEY=<private>
//       supabase secrets set VAPID_PUBLIC_KEY=<public>
//       supabase secrets set VAPID_SUBJECT=mailto:admin@yourdomain.com
//
// ── Mailgun ──────────────────────────────────────────────────
//   supabase secrets set MAILGUN_API_KEY=<your-key>
//   supabase secrets set MAILGUN_DOMAIN=<your-domain.com>
//   supabase secrets set MAILGUN_FROM=SunEscape <noreply@yourdomain.com>
window.VAPID_PUBLIC_KEY = "your-vapid-public-key-base64url";

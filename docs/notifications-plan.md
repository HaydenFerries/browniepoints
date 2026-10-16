# Push notifications: plan (built)

Status: **built**. Setup steps are in the README (Host your own copy → 6. Notifications).
Differences from the plan: the sender uses `jsr:@negrel/webpush` (WebCrypto) because the
Node `web-push` package fails on Supabase's runtime (`crypto.createECDH`), keys come from
`npm run vapid-keys`, and webhooks are checked with an `x-webhook-secret` header.

## Goal

When a partner does something that needs the other person, ping their phone through
the phone's real notification system (lock screen, sound, badge), even when the app is
closed. Tapping the notification opens the matching screen.

## Platform support

- **Android (Chrome):** works, installed or not.
- **iPhone/iPad:** iOS/iPadOS 16.4+, and **only when the app is added to the Home Screen**
  (Safari → Share → Add to Home Screen). Plain Safari can't receive web push.
- Permission must be requested from a user tap (never on page load).

## How it works

1. **Phone:** the app asks for permission (from a button), then subscribes with the
   Push API using our public VAPID key. The subscription (endpoint + keys) is saved in
   Supabase via an RPC.
2. **Trigger:** every meaningful event already writes a row to `public.activity`.
   A Supabase **Database Webhook** on `INSERT` into `activity` calls an Edge Function.
3. **Edge Function (`send-push`, Deno):** looks up the *other* partner's subscriptions
   (never the actor's), builds the message from the activity row, and sends Web Push
   with the private VAPID key (`jsr:@negrel/webpush`, WebCrypto). Subscriptions that come
   back `404`/`410` are deleted.
4. **Service worker (`public/sw.js`):** add `push` (show notification) and
   `notificationclick` (focus/open the app at the right `#hash`) handlers.

GitHub Pages can't send anything, so the sending must live in Supabase. Free tier allows
~500k Edge Function calls/month, which is plenty.

## What to notify (activity kind → message to the other person)

| kind | message | opens |
|---|---|---|
| `task_claimed` | "Sam says they did ‘Dishes’. Approve?" | `#tasks` |
| `task_approved` | "+10 brownies: ‘Dishes’ approved" | `#home` |
| `task_declined` | "‘Dishes’ was sent back to the oven" | `#tasks` |
| `task_added` | "Sam set you a task: ‘Dishes’" | `#tasks` |
| `shared_proposed` / `shared_changed` | "Sam wants to share ‘Mow the lawn’. Review the deal" | `#tasks` |
| `shared_agreed` | "Deal! ‘Mow the lawn’ is agreed" | `#tasks` |
| `reward_added` | "Sam wished for ‘Breakfast in bed’. Set a price" | `#treats` |
| `reward_redeemed` | "Sam cashed in ‘Back massage’" | `#treats` |
| `redemption_delivered` | "Sam delivered your ‘Back massage’" | `#treats` |
| `gift` | "Sam gifted you 5 brownies!" | `#home` |
| (admin) new pending sign-up | "Someone wants in. Review sign-ups" | `#admin` |

Skip noisy kinds (`task_updated`, `task_paused`, `task_bumped`, …) at first. The admin
one needs its own trigger (profiles insert with status `pending`), not the activity webhook.

## Database (new migration)

```sql
create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;  -- no direct access
-- RPCs (security definer, for the signed-in user): save_push_subscription(endpoint, p256dh, auth, ua),
-- delete_push_subscription(endpoint). The Edge Function reads with the service role.
```

Optional later: per-person preferences (which kinds, quiet hours) as a jsonb column on
`profiles`.

## App changes

- `VITE_VAPID_PUBLIC_KEY` env var / repo variable (public).
- Profile sheet: "Notifications on this phone" switch + "Send a test" button; explain the
  iPhone Home Screen requirement when `Notification`/`PushManager` is missing.
- `src/lib/push.ts`: request permission, subscribe/unsubscribe, call the RPCs.
- `public/sw.js`: `push` + `notificationclick` handlers (icon: `icons/icon-192.png`,
  badge, `tag` per task so updates replace older notifications).
- Demo mode: hide the switch (no server).

## Setup steps for the owner (~15 min)

1. Run the new migration in Supabase SQL Editor.
2. Generate VAPID keys (`npm run vapid-keys`). Put the **public** key in
   the `VITE_VAPID_PUBLIC_KEY` repo variable; put the **private** key (and a contact like
   `mailto:you@example.com`) in Supabase → Edge Functions → Secrets
   (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`).
3. Create the `send-push` Edge Function (paste the code in the dashboard editor, or
   `supabase functions deploy send-push`).
4. Database → Webhooks → new webhook: table `activity`, event `INSERT`, type
   "Supabase Edge Functions", function `send-push`.
5. Redeploy the site, then turn on notifications on both phones and send a test.

## Testing

- Unit-test the message builder and the "never notify the actor" rule.
- Real delivery can only be tested on the actual phones (Android + iPhone from the
  Home Screen).

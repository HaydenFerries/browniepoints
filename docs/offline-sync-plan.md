# Offline mode + sync: plan (built)

Status: **built** (all three phases). Code: `src/lib/backend/offline.ts` (queue, replay,
"Couldn't sync"), `src/lib/backend/rules.ts` (rules shared with the demo), `apply_op` in
`supabase/migrations/20261016000000_offline_and_push.sql`. Decided: offline claims of timed
tasks are valued at the time they were done (clamped to now and at most 48h back); things
created offline keep the id the phone gave them, so later queued edits still find them.
Try it in the demo: Profile → Pretend I'm offline.

## Goal

The installed app keeps working with no signal: you can see everything and do things
(mark tasks done, approve, add tasks/wishes, gift…). Changes are kept on the phone and
sync automatically when you're back online. Anything that can't be applied (because your
partner changed the same thing meanwhile) is shown clearly, never silently lost.

## Key idea: sync actions, not records

The app never writes rows directly; every change is already an **action** sent to a
database function (`claim_task`, `review_claim`, `price_reward`, …), and those functions
re-check every rule. So offline mode queues the *actions* and replays them later, rather
than syncing edited records. That turns most "two people edited the same thing" problems
into normal rule checks the server already does:

| Both did this offline | What happens on sync |
|---|---|
| Both marked the same shared task done | First to sync wins (one pending claim per task). The second gets "Already marked as done" and shows in *Couldn't sync*. |
| You approved while they hit "Undo" | Whichever lands first wins; the other is rejected by the rules and reported. |
| You cashed in a treat but your balance changed | The server re-checks the balance; if short, it's rejected (nothing was spent). |
| Both edited the same task's title/price | Needs **version checks** (below); otherwise the last one would silently win. |
| You priced a wish they removed | Rejected: "That reward isn't around any more." |

## Pieces

### 1. Offline viewing (small, do first)
- Cache the last `get_state()` result in IndexedDB; load it instantly on start, then
  refresh from the server when online.
- Banner: "Offline · last synced 10 min ago". Service worker already caches the app shell.

### 2. Outbox (the queue)
- Every action becomes `{ id: uuid, name, args, createdAt }`, stored in IndexedDB in order.
- **Optimistic UI:** apply the action to the cached state straight away so the screen
  updates. The in-browser demo backend already implements every rule locally, so it can
  be reused to compute the optimistic state. Queued items show a small "waiting to sync"
  marker.
- **Replay** in order when back online (`online` event, app brought to front, app start).
  Background Sync API helps on Android only; iOS relies on the app being opened.
- After replay, re-fetch `get_state()` so both phones agree on the truth.

### 3. Safe retries (idempotency)
- A flaky connection can send the same action twice. Add a `applied_ops(op_id uuid primary
  key, user_id, applied_at)` table and an `apply_op(op_id, name, args)` wrapper RPC that
  does nothing if `op_id` was already applied. Each queued action keeps its uuid, so a
  retry can never claim/gift/redeem twice.

### 4. Version checks for edits (the real "same record" conflicts)
- Add `version int` to `tasks` and `rewards`, bumped on every change.
- Edit actions send the version they were based on; the function rejects with
  "changed by Sam since" if it doesn't match.
- *Couldn't sync* then shows both versions: **Keep theirs** (discard mine) or
  **Use mine** (re-send based on the new version). Shared-task edits already go back to the
  partner for agreement, so they're naturally safe.

### 5. "Couldn't sync" list
- A sheet listing rejected actions with the reason in plain words and buttons:
  Retry, Discard, or Edit and resend. Never drop anything silently.

## Decisions to make later

- **Timed tasks done offline:** value should be what it was *when you did it*, not when it
  synced. Option: send the device time with the claim and let the server accept it within
  limits (not in the future, not before the last warm-up, at most ~48h old). Trust is
  fine for a couple's app.
- **What's blocked offline:** sign-in/sign-up, pairing, admin actions (need the server).
  Everything else can queue.
- **Order between partners:** actions from different phones are applied in arrival order;
  per-phone order is preserved.

## Rough effort

1. Offline viewing + banner: small.
2. Outbox + optimistic UI + replay + idempotency: the bulk of the work.
3. Version checks + conflict sheet: medium.

Phases can ship separately; phase 1 alone already makes the app usable without signal.

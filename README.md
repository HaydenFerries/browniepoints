# 🍫 Brownie Points

Sweet rewards for the little things couples do for each other.

Each partner controls three things:

1. **Tasks for their partner**, and how many brownies each one is worth.
2. **Their own wishlist**: the treats they'd love in exchange for brownies.
3. **The price of their partner's wishes**. You're the one giving it, so you set the cost.

Partners pair up with a code (like `FUDGE-7K2QX`) or an invite link, and both can see
everything: both brownie jars, both task lists, both wishlists and the full history.
Changes show up live on the other phone.

## How it plays

| You…                               | Your partner…                                   |
| ---------------------------------- | ----------------------------------------------- |
| set a task worth 10 brownies       | taps **I did it!**                              |
| tap **Approve** (or **Not yet**)   | gets 10 brownies dropped into their jar         |
| price their wish at 30             | taps **Cash in** once they have 30              |
| tap **Delivered** after doing it   | enjoys their treat 💆                           |

You can also **Treat** your partner with a few spontaneous brownies and a note.

## Invite-only sign-ups

New accounts start as **pending** and only see an "Account waiting for approval" screen.
The database itself refuses every action from a pending account, so it can't pair, see
anyone or create anything. Admins manage accounts from the **Admin portal** in the app
(Profile → Admin portal):

- **Approve** or **reject** sign-ups. Rejected people can still sign in, but they see that
  their sign-up wasn't approved (plus an optional message from you).
- **Suspend** members. They see a "your account is suspended" screen and can't use or
  read anything; their data and pairing are kept. **Restore** them any time.
- **Delete** an account and everything it created.

Sign-up, sign-in and password reset are also protected by a
[Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) captcha.

## Tech

- **Vite + React + TypeScript**, installable as a PWA (add to home screen on iOS/Android).
- **Supabase** for accounts, data and live updates. All writes go through Postgres
  functions that enforce the rules: you can't approve your own task, price your own
  wish, or overspend. Balances are a ledger, never a stored number.
- **Demo mode**: with no Supabase keys the app runs entirely in the browser (open two
  tabs to play both partners). Any deployment also offers a sample-data demo.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Without keys in `.env.local` you're in demo mode. To test on your phone over Wi-Fi:
`npm run dev -- --host`, then open the "Network" URL it prints.

Other scripts:

```bash
npm run build        # type-check + production build into dist/
npm run test:db      # runs the Supabase migrations on PGlite and checks every rule
npm run images       # regenerate brownie cut-outs/icons from assets-src/
```

## Host your own copy

You need a free [Supabase](https://supabase.com) project, a GitHub repo with Pages, and
(for the captcha) a free Cloudflare account.

### 1. Database

In Supabase → **SQL Editor**, run each file in [`supabase/migrations/`](supabase/migrations)
in order (or let Supabase's GitHub integration apply them). They're safe to re-run.

Then make yourself the admin, using the email you signed up with in the app:

```sql
update public.profiles set is_admin = true, status = 'approved'
where id = (select id from auth.users where email = 'you@example.com');
```

### 2. Auth settings

- **Authentication → Sign In / Providers → Email**: optionally turn off *Confirm email*
  (Supabase's built-in mailer only sends a few emails per hour).
- **Authentication → URL Configuration**: set *Site URL* to your deployed address
  (e.g. `https://<github-user>.github.io/<repo>/`) and add `http://localhost:5173` to
  *Redirect URLs*.

### 3. Keys

| Setting | Where it comes from | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API | the app |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys (*publishable* / anon) | the app |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → your widget (*site key*) | the app |

For local development put them in `.env.local` (see [`.env.example`](.env.example); it's
git-ignored). For the deployed site add them as repository **Variables** (Settings →
Secrets and variables → Actions → Variables).

These three are public by design and end up in the website's code. Two keys must
**never** go in the app, the repo or its variables: Supabase's *secret / service_role*
key, and Turnstile's *secret key* (that one goes only into Supabase, step 5).

### 4. Deploy to GitHub Pages

Settings → Pages → **Source: GitHub Actions**, then push to `main`. The
[workflow](.github/workflows/deploy.yml) tests the SQL, builds, and publishes.

### 5. Turn on the captcha (after the site is deployed)

1. Cloudflare → **Turnstile** → *Add widget*, hostname = your Pages domain
   (add `localhost` too if you want to sign in from `npm run dev`).
2. Make sure `VITE_TURNSTILE_SITE_KEY` is set and the site has been redeployed.
3. Supabase → Authentication → **Bot and Abuse Protection** (may be called *Attack
   Protection*): enable CAPTCHA, choose Turnstile, paste the **secret key**.

Do step 3 last: once it's on, Supabase rejects sign-ins that don't carry a captcha
token, so a site without the site key would lock everyone out. People already signed in
are unaffected.

## Project layout

```
src/
  app/            App shell, routing, store (state, live updates, toasts)
  screens/        Welcome, Waiting, Pair, Home, Tasks, Rewards, History, Profile, Admin
  components/     Brownie icon, Jar, chocolate Drip, Captcha, sheets, pickers
  lib/backend/    Backend interface + Supabase and in-browser demo implementations
supabase/
  migrations/     Schema, row-level security and all RPC functions
  tests/          PGlite test that plays every role through every rule
scripts/          Image processing (brownie cut-out, app icons, hero)
assets-src/       Original photos
```

## Credits

- Brownie cut-out: [“Chocolatebrownie.JPG”](https://commons.wikimedia.org/wiki/File:Chocolatebrownie.JPG)
  by Ɱ, Wikimedia Commons, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
  The cut-out and the app icons made from it are shared under the same licence.
- Welcome photo: [Eve Maier on Unsplash](https://unsplash.com/photos/a-stack-of-brownies-sitting-on-top-of-a-white-plate-f979oad8TDs)
  (Unsplash License).
- Fonts: Fraunces and Nunito (SIL Open Font License).

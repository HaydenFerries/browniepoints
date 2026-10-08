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

## Tech

- **Vite + React + TypeScript**, installable as a PWA (add to home screen on iOS/Android).
- **Supabase** for accounts, data and live updates. All writes go through Postgres
  functions that enforce the rules: you can't approve your own task, price your own
  wish, or overspend. Balances are a ledger, never a stored number.
- **Demo mode**: with no Supabase keys the app runs entirely in the browser (open two
  tabs to play both partners). The deployed site also offers a sample-data demo.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Without `.env.local` keys you're in demo mode. To test on your phone over Wi-Fi:
`npm run dev -- --host`, then open the "Network" URL it prints.

Other scripts:

```bash
npm run build        # type-check + production build into dist/
npm run test:db      # runs the Supabase migration on PGlite and checks every rule
npm run images       # regenerate brownie cut-outs/icons from assets-src/
```

## Connect Supabase

1. **Create the database.** In Supabase → SQL Editor, paste and run
   [`supabase/migrations/20261009000000_brownie_points.sql`](supabase/migrations/20261009000000_brownie_points.sql).
   (If the GitHub integration is set to deploy migrations, it picks this file up instead.)
   It's safe to run again.
2. **Auth settings** (Authentication → Sign In / Providers → Email):
   - For the smoothest start, turn **off "Confirm email"**. Otherwise new accounts must
     click a confirmation link first, and Supabase's built-in mailer only sends a few
     emails per hour.
   - Under Authentication → URL Configuration, set **Site URL** to
     `https://haydenferries.github.io/browniepoints/` and add `http://localhost:5173` to
     **Redirect URLs** (used by confirmation and password-reset emails).
3. **Local keys.** In `.env.local`, fill in `VITE_SUPABASE_PUBLISHABLE_KEY` from Project
   Settings → API Keys (the *publishable* / anon key, never the secret / service_role
   key). The URL is already set.

## Deploy to GitHub Pages

1. Repo → Settings → Pages → **Source: GitHub Actions**.
2. Repo → Settings → Secrets and variables → Actions → **Variables** tab, add:
   - `VITE_SUPABASE_URL` = `https://xkchxhtzdkfxnqrycxlc.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your publishable key
3. Push to `main`. The workflow tests the SQL, builds, and publishes to
   `https://haydenferries.github.io/browniepoints/`.

## Project layout

```
src/
  app/            App shell, routing, store (state, live updates, toasts)
  screens/        Welcome, Pair, Home, Tasks, Rewards, History, Profile, sheets
  components/     Brownie icon, Jar, chocolate Drip, sheets, pickers
  lib/backend/    Backend interface + Supabase and in-browser demo implementations
supabase/
  migrations/     Schema, row-level security and all RPC functions
  tests/          PGlite test that plays both partners through every rule
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

# StudioFlow Portal Template

Base template for all client-facing StudioFlow creative portals.

## What's Included

- **Dashboard** — Active system cards + locked "coming soon" placeholders
- **Brand Intelligence** — Editable markdown document (view + edit mode)
- **Auth** — Magic link via Better Auth + Resend (no password required)
- **DB** — Core tables: `user/session/account/verification` (Better Auth) + `users` + `app_config` + `brand_intelligence` + `activity_log`

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + Radix UI
- Drizzle ORM + **Neon PostgreSQL** (direct connection)
- **Better Auth** (magic link via Resend)
- Vercel deployment

## How to Use

1. **Create a new repo from this template** on GitHub (`sergiu-studioflow` account)
2. **Clone locally**
3. **Create Neon project** in `eu-central-1` — copy the connection string
4. **Copy `.env.example` to `.env.local`** and fill in:
   ```
   DATABASE_URL=postgresql://...?sslmode=require     # Neon connection string
   BETTER_AUTH_SECRET=                               # openssl rand -base64 32
   BETTER_AUTH_URL=https://your-portal.vercel.app
   NEXT_PUBLIC_APP_URL=https://your-portal.vercel.app
   RESEND_API_KEY=re_...
   WEBHOOK_SECRET=
   ```
5. **Install dependencies**: `npm install`
6. **Run migrations**: `npm run db:migrate`
7. **Run seed**:
   ```
   SEED_BRAND_NAME="BrandName" SEED_ADMIN_EMAIL="client@company.com" npm run seed
   ```
8. **Customize brand** — see checklist below
9. **Deploy to Vercel** — set all env vars in Vercel dashboard
10. **Send magic link** to admin email from the `/login` page
11. **Grant admin role** — run SQL after first login:
    ```sql
    INSERT INTO users (user_id, display_name, email, role)
    SELECT id, name, email, 'admin' FROM "user" WHERE email = 'admin@email.com'
    ON CONFLICT DO NOTHING;
    ```

## Brand Customization Checklist

- [ ] Replace `public/client-logo.png` with client logo (40×40px PNG)
- [ ] Update `--primary` HSL values in `src/app/globals.css` (if brand color differs from neon green)
- [ ] Update `BRAND_INTEL_CONTENT` in `scripts/seed-client.ts` with brand intelligence markdown
- [ ] Update `src/lib/auth.ts` `trustedOrigins` with production + custom domain URLs
- [ ] Update `src/app/layout.tsx` metadata title/description

## Adding New Systems (MIGRATE mode)

When adding a new system page to an existing portal:
1. Add tables to `src/lib/db/schema.ts`
2. Add types to `src/lib/types.ts`
3. Add API routes under `src/app/api/`
4. Add page under `src/app/(portal)/`
5. Add nav item in `src/components/layout/portal-sidebar.tsx`
6. Add system card in `src/app/(portal)/dashboard/page.tsx`
7. Run `npm run db:generate && npm run db:migrate`

See `.claude/skills/client-portal-builder/SKILL.md` for full MIGRATE mode instructions.

## Repo Naming Convention

`studioflow-[brand-slug]` (e.g., `studioflow-naali`, `studioflow-lion-advisory`)

All portal repos live in `.Portals/` locally.

## Updating All Portals

When the template design changes:
1. Apply changes to this template repo + commit
2. In each client repo: `git fetch template && git merge template/main`
3. Resolve conflicts in favor of client version for: logo, CSS primary colors, seed data, system-specific pages
4. Push → Vercel auto-deploys

See `.claude/skills/client-portal-builder/SKILL.md` for full UPDATE mode instructions.

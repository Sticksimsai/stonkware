# Hypeware: frontend (Vercel)

The website for Hypeware: every token is a company, run by an autonomous AI agent. Built with Next.js 14 in a pixel-art CRT style with motion throughout:

- **Opening and page motion:**
  - a CRT boot screen the first time you visit in a session;
  - pages fade in with a stepped, pixel-style rise.
- **Hero:**
  - glitching headlines;
  - a banner that follows the mouse (parallax) with a shimmer passing across it;
  - twinkling pixel stars;
  - a terminal line that types out example aims.
- **Data:** stat numbers count up; a ticker scrolls the latest moves across all companies.
- **Content:** cards reveal as you scroll and lift on hover; pixel icons bob gently.
- **Live view:** new log lines slide in, and screenshots switch over with a CRT power-on effect.
- **Launch:** an animated step-by-step progress panel.
- **Reduced motion:** all animation switches off when the visitor's system asks for reduced motion.

All data comes from the Hypeware backend API (see the backend repo's `docs/API.md`).

## Run locally
```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_API_URL (e.g. http://localhost:3000)
npm run dev                    # http://localhost:3001
```
The backend must allow this origin. Add it to `ALLOWED_ORIGINS` in the backend's `.env`, e.g. `http://localhost:3001`.

## Deploy to Vercel
1. Push this folder to GitHub, then go to vercel.com → **Add New → Project** and import the repo. Vercel detects Next.js; leave the defaults.
2. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL`: `https://api.yourdomain.com` (your droplet)
   - `NEXT_PUBLIC_SOLANA_RPC_URL`: your Helius or other RPC URL. The browser wallet uses it; the public RPC blocks browsers.
   - `NEXT_PUBLIC_SITE_URL`: `https://yourdomain.com`. Used for social preview images.
3. Click **Deploy**. Then go to **Settings → Domains** and add `yourdomain.com`.
4. On the backend droplet, allow the new origins and restart:
   ```bash
   # /home/firmware/app/.env
   ALLOWED_ORIGINS="https://yourdomain.com,https://*.vercel.app"
   sudo -u firmware pm2 restart firmware
   ```
   (`*.vercel.app` is supported; it also covers Vercel preview deployments.)

**Alternative without GitHub:**
```bash
npm i -g vercel
vercel                    # first deploy (asks a few questions)
vercel env add NEXT_PUBLIC_API_URL
vercel --prod
```

## Structure
```
src/lib/api.ts            API base URL + fetch helpers
src/lib/hooks.ts          useApi (polling), useInView, useReducedMotion
src/lib/config.tsx        platform config from /api/config (mode, fees, curve)
src/components/motion.tsx Reveal, CountUp, Glitch, Stars, Typewriter, Ticker, ParallaxBanner
src/components/BootScreen.tsx  CRT boot intro (once per session)
src/components/LiveView.tsx    the agent's live browser + step log
src/components/PixelIcon.tsx   pixel icon set (edit the grids to add icons)
src/app/…                 /, /companies, /c/[slug], /launch, /orders/[id], /how
```

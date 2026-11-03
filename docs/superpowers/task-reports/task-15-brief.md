### Task 15: Container, deployments, README and submission text

**Files:**
- Create: `services/pulse/Dockerfile` (build context is the repo root):
  - `FROM node:22.19-slim`
  - `WORKDIR /app`
  - copy the root `package.json` and `package-lock.json`, then
    `npm ci --omit=dev --ignore-scripts`
  - copy `services/pulse/package*.json`, then
    `npm ci --prefix services/pulse --omit=dev`
  - copy `lib`, `shared`, `data` and `services/pulse/src`
  - `ENV NODE_ENV=production`
  - `CMD ["npx","tsx","services/pulse/src/server.ts"]`
  - Move `tsx` to the service's `dependencies` so it survives
    `--omit=dev`.
- Create: `.dockerignore` (`node_modules`, `dist`, `.git`,
  `services/pulse/spike/out`)
- Create: `docs/submission/devpost.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - **The live container**, on Railway or Render. Its env is:
    `DATABASE_URL` (hackathon branch), `QLOO_API_KEY`, `GROQ_API_KEY`,
    `TMDB_API_KEY`, `PULSE_ALLOWED_ORIGINS`, `PULSE_WARM_SECRET` and
    `PORT`.
  - **A separate hackathon Vercel project.** Its env is the existing vars
    plus `DEMO_GUEST=1`, `VITE_DEMO_GUEST=1` and `VITE_PULSE_URL`.
  - **GitHub settings:** the secret `PULSE_WARM_SECRET` and the variable
    `PULSE_URL`.

- [ ] **Step 1:** Run `docker build -f services/pulse/Dockerfile -t
  pulse . && docker run --rm -p 8787:8787 --env-file .env.pulse pulse`,
  then `curl localhost:8787/healthz`. Expected: `{"ok":true}`.
- [ ] **Step 2:** Deploy the container and the Vercel project. Run
  `curl -fsS $PULSE_URL/healthz` and expect `{"ok":true}`. Then call
  `/warm` with the secret, and expect a JSON report with `warmed > 0`.
- [ ] **Step 3: README.** Replace the WebMCP top note with a "Qloo
  Agentic Hackathon submission" section. Keep the WebMCP material lower
  down as history. It contains:
  - What's new since 30 Sep 2026: list the commits on `feat/release-pulse`
    and the Pulse files.
  - Test in 60 seconds: the live URL, then `/pulse`, Delhi → Café,
    open the #1 card, flip "Without Qloo", and ask the chat.
  - The Qloo tools used and why.
  - A redacted request-to-result walkthrough for one brief: the entity and
    tag choices, and the params with no key.
  - Known limitations: the global (not per-city) demographics, India
    release dates in NYC and London, and Wikipedia coverage gaps.
  - Setup steps for the service.
- [ ] **Step 4:** Write `docs/submission/devpost.md`: the problem, the
  audience, what it does, how it's Qloo-powered, the evidence numbers from
  the spec, and the limitations.
- [ ] **Step 5: Judge run-through.** In a fresh incognito window on the
  live URL, with no sign-in, check that:
  - `/pulse` shows Delhi/Café with ranked cards in under 10 s,
  - a brief streams in, with a heatmap, venues and a hook where one
    exists,
  - the toggle works,
  - the chat answers and cites Qloo,
  - New York shows the India-dates note,
  - an unknown-city URL shows the picker.

  Then check the repo's About sidebar shows the MIT license. Take
  screenshots.
- [ ] **Step 6:** Run `npm run typecheck && npm test && npm run test:pulse
  && pytest`. Expected: all pass. Then commit.

```bash
git add services/pulse/Dockerfile .dockerignore README.md docs/submission/devpost.md services/pulse/package.json services/pulse/package-lock.json
git commit -m "Ship Pulse: container, hackathon deployment, README and submission text"
```

# Session log: how Release Pulse was built

A chronological record of the work, so the reasoning survives even if the chat does. Decisions in full, with
reasons and the cost if each was wrong, are in `docs/superpowers/checkpoints/2026-10-21-release-pulse-ledger.md`
(39 numbered rulings). Per-task requirements and reports: `docs/superpowers/task-reports/`.

## Stage 1: choosing the idea (2026-10-20 and 21)

- Input: the Qloo Agentic Hackathon rules (judged equally on technical use of Qloo, design, impact and idea quality)
  and the existing Spotlight app (an India OTT release radar with watchlists).
- Five research agents ran in parallel: what Qloo's API can really do (location, cross-domain, India coverage), where filming-location
  data comes from (Wikipedia categories beat Wikidata for Indian films), what won Qloo's previous hackathon, how the idea maps onto
  the Spotlight code, and market evidence.
- Findings that shaped everything: last year's winners were B2B "agent as analyst" tools; consumer set-jetting and recommender apps were
  the crowded lane and won nothing; Qloo cannot answer "movies shot in Delhi" (its filming field is one unfilterable string), but is strong at
  "places in a city that fans of this title love".
- Decision: lead with a **business** product (café or D2C food brand in a city), keep the location and "plan the night" ideas as features, and
  write the consumer-led variant up as a deferred design (`docs/superpowers/specs/2026-10-21-consumer-taste-companion-design.md`).

## Stage 2: design, plan, build (2026-10-21)

- A design document and a 15-task plan were written and reviewed by a fresh "builder check" agent before any code.
- The plan was executed **subagent-driven**: for every task an implementer agent (Sonnet) built it with tests first, the controller
  re-verified independently (suites, and live runs of the running service wherever possible), a separate reviewer judged spec compliance and
  quality, and findings went through fix rounds with scoped re-reviews. Tasks 2 to 14 all completed this way.
- Standing instructions from the owner: no questions mid-run, Sonnet 5.5 for agents, verify everything.
- Notable decisions: the service is a separate Node container (Qloo's kit says serverless is unsupported, and Vercel was at its 12-function cap);
  only titles Spotlight already knows can be briefed (bounds Qloo spend on a public endpoint); per-client rate limits and daily LLM caps on every
  public route; the campaign writer must cite evidence ids and anything uncited is shown as "Agent suggestion"; Groq (free) as the model.
- Two interruptions by the owner's usage limit; the work resumed from the ledger each time.

## Stage 3: first pause, keys, live verification (2026-10-21)

- A checkpoint was committed, then the owner supplied the Qloo, Groq and TMDB keys (kept in a gitignored env file; never printed).
- **Live Qloo spike: GO.** Real heatmaps, cafés, themes, brands, artists; demographics for established titles only; trends empty everywhere.
- Live findings were fixed and reviewed: a TMDB hiccup was being cached as "Qloo does not know this title" (now separated from a real 404); thin-signal
  titles returned HTTP 400 and were reported as errors (now an honest, cached `empty`, with a circuit guard so a systematic 400 is not hidden); themes
  and brands were noisy (filtered to food families and food and drink brands); duplicate venues; Plan the Night suggested landmarks and hotels.
- **Groq's free tier** turned out to be 8,000 tokens a minute and 1,000 requests a day, so a normal chat hit a rate limit on its second call. The chat was
  slimmed (7 tools, shorter prompt, smaller tool results), the client queues and waits briefly on a 429, drafts get a 60 s deadline, and daily caps were lowered.
- Second pause: services stopped, non-Qloo data backed up, checkpoint committed. Final verification of that stage: service 976 tests with Postgres,
  SPA 741, Python 241; one real brief with a live campaign in about 8 s.

## Stage 4: product evaluation and hosting preparation (2026-10-25 and 26, a later session)

- Render hosting was prepared (`render.yaml`, `/readyz`), the board ranking was fixed to handle thin signal, the chat was constrained to scoped tool
  evidence, and a paired evaluation compared Qloo-grounded campaigns with the same model without Qloo (`docs/submission/evaluation-*.md`).
- Verdict recorded by that session: improved integrity and presentation, but **no repeatable business advantage demonstrated** and no useful city
  ranking for current releases; public deployment was put on hold. A full acceptance pass found the natural-language "Friends" failure.

## Stage 5: getting everything into the repository (2026-11-03)

- It was found that none of the 46 commits had ever been pushed; `main` was unchanged since 2026-10-05.
- A full backup was made, then the branch was pushed as `feat/release-pulse` (full history, kept as an archive) and the work was repackaged as
  **one commit** on `feat/release-pulse-squashed` with a pull request, so it can be merged, or built on, in one step.
- Found while doing this, unrelated to the code: the Vercel account behind the live site is blocked (HTTP 402).
- The hackathon submission period had closed (2026-10-30, 11:45 pm Eastern); whether an entry was submitted is not recorded anywhere in the repository.

## Method notes worth reusing

- Verify with the running system, not just unit tests: most real defects here (silent failures on thin Qloo data, a Groq rate limit, a cache that kept a
  mistake for three days) only appeared in live runs.
- Every public endpoint got the same shape: validate, rate limit, check the title is known, then spend anything external.
- Reviews were scoped and independent; when a reviewer's finding was a design question, the decision and its cost were written to the ledger.

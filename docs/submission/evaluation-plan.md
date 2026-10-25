# Frozen paired evaluation, version 2 — October 26, 2026

Version 1 was stopped after observed quality failures; preserve its results in
ignored evaluation-oct26-pilot-v1 and report them separately. Version 2 uses the
same bounded trial composer for both arms: model chooses plan/context, source
facts are rendered verbatim, and action text comes from reviewed templates.
This deliberately constrains creativity; it is not a test of unrestricted copy.

Freeze before new campaign generations. Ten contexts: Nobody Wants This
Season 3 (Delhi café / Mumbai D2C); The Legend of Hanuman Season 7 (Delhi D2C /
Mumbai café); Dorothy (Delhi café / Mumbai D2C); Nocturne, a previously unresolved
control (Delhi café / Mumbai D2C); and the owner's Nothing Before Coffee × Friends
brief in Delhi and Mumbai. The latter are explicit city assumptions, coffee is
the only confirmed product category, and budget/assets are unknown. Both arms
receive that identical business brief. Friends is an established catalogue
control, not an upcoming release or proof of new-release coverage. NBC's
[official site](https://nothingbeforecoffee.com/) confirms the coffee business;
branch inventory, prices, staffing and rights are not inferred from it.
The other titles are actual source releases, not a claim
that all are future releases. The board is separately checked for today's slate.
Two independent generations per context per arm; counterbalance arm order.

The same Groq model, temperature, output schema, practical constraints, retry
policy and deadlines apply to both arms. Baseline sees title, city, business
type, release date and any supplied business brief only. Qloo sees those plus the frozen production evidence
bundle for that context. Bypass campaign caches; allow production evidence
caches. Store prompt hash, model, order, calls, timing, failures and abstentions.
No Qloo data goes into the committed report; raw data remains in ignored out/.
No fixture evidence and no model training.

## Checks

- Mechanical: source completion, valid output, fallback/error/abstention rate,
  valid citation IDs, no baseline citations, latency including pacing/retries.
  A retry consumed to repair quality is reported, not hidden as a first-pass win.
- Manual: inspect every generated clause against its evidence for invented or
  overstated facts and geographic scope. Separately inspect feasibility (menu,
  rights, partners, channels), concrete action and a small observable trial.
  Mechanical checks cannot score these reliably.
- Value: compare the paired proposals for a business decision changed by actual
  evidence. An extra name/citation alone is not value. Record ties and failures;
  do not score Qloo better merely for being able to cite Qloo. Unresolved Qloo
  inputs should abstain, not be counted as successful recommendations.

## Acceptance before public deployment

- At least 90% usable drafts on evidence-backed runs; no critical unsupported
  claims about access/rights/partners, individual preferences or city audiences
  in the inspected final outputs. No placeholder counts as usable.
- At least two repeatable, practical decisions attributable to Qloo evidence
  in different title contexts, with limitations visible. This internal check
  alone is insufficient: a café/food-business owner must find the proposals
  actionable before claiming customer usefulness or an advantage over baseline.
- Board must compare at least two titles before displaying ordinal city ranks;
  returned/requested coverage and release-order fallback must be explicit.
  A fallback fixes honesty/usability, not city-demand prediction.
- Regression suite and local guest/brief/comparison/chat/error/retry walkthrough
  pass after changes. Actual Linux container/restart and hosted transport checks
  remain required; no public deployment while acceptance is incomplete.

This is a small internal evaluation, not a statistical study. One model family,
four resolvable title contexts and two cities cannot establish generality,
business uplift or odds of winning. No automated self-judge will be presented
as customer evidence. Disclose unblinded internal review and outstanding gates.

Run: from services/pulse, set the intended DATABASE_URL, then
`npx tsx --env-file=.env spike/evaluate.ts --live`. Live runs spend provider quota.

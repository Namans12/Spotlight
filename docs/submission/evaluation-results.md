# Release Pulse evaluation results — October 26, 2026

**Verdict: keep public deployment on hold.** Ranking presentation and proposal
integrity are improved. A repeatable business advantage over the LLM-only arm
has not been demonstrated. This is an internal, unblinded evaluation, not a
customer study, a demand forecast or an estimate of winning probability.

## Protocol and retained failures

See [the frozen plan](evaluation-plan.md). Both arms used Groq
`openai/gpt-oss-120b`, low reasoning effort, temperature 0.4, identical practical
constraints, output schema, deadlines and retry policy. Campaign caches were
bypassed. Production Qloo evidence caches were allowed and each context's bundle
was frozen before paired generations. Arm order was counterbalanced.

The initial prompt-only pilot was stopped after **13 outcomes: 10 usable, three
fallbacks, 19 model calls**. It still invented menu/rights assumptions and mixed
proposals with cited facts. Those outcomes remain in private pilot artifacts;
they were not replaced by successful retries in the report below.

The replacement composer lets the model select source context and a plan from
six bounded actions. Cited text is copied from the provided fact bundle. Actions
use conditional templates for existing products, owned channels and small trials.
Both arms use this same action vocabulary. This reduces creative freedom; it
does not establish that the chosen context is relevant to a real business.

## Main paired run

Ten contexts, two generations per arm: **40 outcomes**. Three source release
titles in Delhi/Mumbai across café and D2C use cases, an unresolved-title control
in both cities, and the owner's Nothing Before Coffee × Friends brief in both
cities. Friends is an established catalogue control, not an upcoming release.
The city choices were evaluation assumptions; no outlet, menu, budget, channel
access or rights were invented. The two arms received the same business brief.

| Measure | Qloo context + model | Same model without Qloo |
|---|---:|---:|
| Usable drafts on evidence-backed contexts | 15 / 16 | 16 / 16 |
| Fallbacks on those contexts | 1 | 0 |
| Unresolved controls | 4 abstentions | 4 generic drafts |
| Model calls including retries | 22 | 20 |
| Successful writer median | 10.34 s | 2.59 s |
| Successful writer maximum | 54.01 s | 14.47 s |

Writer times include pacing/retries but exclude source capture and browser
rendering. The arms used different prompt lengths; this is not a controlled
provider speed benchmark. The fallback failed JSON/structure validation after
three attempts; it remains a failure, not a usable draft.
Call counts are writer-level client invocations; internal HTTP/provider retries
are not separately counted and these numbers are not a provider billing ledger.

Offline audit found **76 cited context clauses**, zero unknown references, zero
context-text mismatches against the frozen bundle, and zero baseline citations.
This verifies traceability by construction, not independent truth of Qloo's
underlying data or feasibility of a business decision.

Of 15 successful paired comparisons, **34 of 45 action-plan selections matched**;
seven pairs selected the same three plans. Different plan choices also do not
prove improvement: they can reflect model variability. Internal inspection did
not establish two repeatable business decisions improved by Qloo evidence.

## Corrections and final-code follow-up

The walkthrough found two presentation/input issues after the main run: hotel
genres incorrectly passed the food-theme family filter, and displayed
demographic context did not always say global. The taxonomy now excludes
non-food place genres, including on cache reads; demographics explicitly say
global in campaign facts, chips, the brief and chat summaries. No main-run final
proposal cited the removed hotel tags. The main run is retained as a prior-code
result rather than described as a final-code benchmark.

A separate final-code follow-up repeated Hanuman/Delhi D2C and both NBC/Friends
contexts twice per arm: **12 outcomes, six usable per arm, one model call each**.
It audited 27 cited context clauses with zero unknown references, text mismatches
or baseline citations. The saved campaign-source hash matches the final composer.
Successful writer medians were 9.57 s with Qloo and 0.78 s without. Thirteen of
18 plan selections matched; two of six pairs used the same three plans. Do not
pool this small follow-up with the main run to conceal its earlier failure.

## Ranking diagnosis and actual board behavior

Twenty live controls were run across separate movie/TV slates: original/reversed
order, entity-seed ranking, city discovery, larger take, New Delhi spelling,
Mumbai, New York, no-signal requests and location weight. For the three-title
established controls, location-conditioned fixed slates consistently returned
one title, while no-signal requests returned all three; city discovery returned
ten. Entity-signal controls returned two (excluding the seed). This narrows the
failure but does not establish its underlying API cause or geographic accuracy.
The official harness and CLI were used; no cross-query score was substituted.

On the October 26 current-release slate, Delhi and Mumbai each had 20 candidates:
10 films, 10 TV, six theatrical. Seventeen resolved; three did not. City rank
responses returned **zero of ten film and zero of seven resolved TV candidates**.
Both completed boards therefore show 17 titles in release order, all six
theatrical titles accessible, no ordinal rank, no numeric score and no pending
ranking. Returned/requested coverage is visible. A lone returned title is also
insufficient for a comparison and is never promoted to #1.

The display bug is fixed. Useful city-conditioned ranking of current releases
remains unproven. Release order is an honest fallback, not a Qloo ranking win.

## Chat was a separate bypass

A real browser chat about NBC/Friends still invented a cold brew, a branded latte,
account access, rights advice and footfall claims despite the prompt rules.
Campaign-template changes alone did not protect chat. Public `/chat` now wraps
tool results in a per-request collector and supplies a final renderer to the
agent loop. Model prose is discarded at the public boundary. Brief summaries
preserve global versus city scope, missing sections and conditional existing-
product plans. Board answers preserve release-order fallback. Other lookups
receive bounded source summaries rather than invented business advice.

The model still selects and invokes tools; this is deliberately an evidence
browser with bounded planning, not an unrestricted marketing-copy assistant.
Regression tests replay the observed unsafe answer and verify that it cannot
reach the public message. Final live chat verification is recorded in
[validation](validation.md); do not infer chat correctness from the campaign
benchmark alone.

## NBC × Friends: what this does and does not establish

The [official NBC site](https://nothingbeforecoffee.com/) supports the coffee
business context. Specific branch stock, prices, staffing, budget and rights
were not verified. The obvious coffee/Friends connection is available to the
baseline. Qloo contributes inspectable aggregate demographic, geographic,
venue and cultural associations, but current action plans largely remain
bundles, polls and discussions. No sale, owner preference, outlet selection,
incremental conversion or willingness to pay was measured.

The most promising next hypothesis is an **existing-outlet choice or local
research decision**, using established-title evidence and confirmed business
constraints. That hypothesis has not been implemented or validated. Do not
silently transfer a franchise's audience to a new release or turn affinity into
expected attendance. No business was contacted and no paid plan was enabled.

## Reproduce privately

From services/pulse with the intended DATABASE_URL and ignored env configured:

```bash
npx tsx --env-file=.env spike/evaluate.ts --live --run=new-run-name
npx tsx spike/evaluationReport.ts --run=new-run-name
npx tsx --env-file=.env spike/rank.ts --city=delhi --rank-only
```

`--live` / `--rank-only` spend quota. Report auditing is offline. Existing run
names cannot be overwritten. The runner saves model, source hash, contexts,
order, raw attempts, source sections, timing, retries, failures and abstentions
under gitignored spike/out. Neither source payloads nor the local DB belong in
the repository, Docker image or submission attachments.

Actual Linux container execution, hosted ingress/concurrency and real business
feedback remain acceptance gates. No push, deployment or submission was done.

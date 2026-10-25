# Release Pulse product validation — October 26, 2026

**Decision: hold public deployment.** Local implementation checks passed earlier,
but useful ranking and campaign quality have not passed product acceptance.
This report records exploratory checks, not a benchmark or winning prediction.

**Later October 26 work:** fixes and the completed paired evaluation are recorded
in [evaluation results](evaluation-results.md). The sections below preserve the
pre-fix findings that triggered that work.

## Live checks performed

Eight sequential real Qloo controls used three established movie IDs and three
established TV IDs, separately. Each type was tested with the original slate,
reversed slate, an entity signal instead of a city, and city discovery without
a fixed slate. For each type: original and reversed Delhi slates returned one
result (the same entity); entity-signal ranking returned two; Delhi discovery
returned ten. All tool envelopes reported success. These results show that
multi-result responses work, and input order alone does not explain the sparse
city shortlist. They do not establish the underlying cause or geographic
coverage. The current-release board still needs a useful comparison before it
can be presented as a title-selection advantage.

Two real brief/baseline pairs were then requested through the service:
Nobody Wants This Season 3, Delhi café and Mumbai D2C food. Both briefs reached
`done` and produced campaigns; both LLM-only comparisons returned three ideas.
The café had venue, theme and artist evidence; D2C had theme, brand and artist
evidence. Both had empty demographics, heatmap, local hook and trend sections.
The service logged heatmap contract rejections during warming; an empty section
must not be interpreted as established absence of local affinity.

These are two contexts for **one title**, one generation per arm. They cannot
establish repeatability, geographic generality, superiority or business impact.
Raw provider responses and generated outputs remain in gitignored spike/out.

## Failures found by reading generated proposals

- Café output forced venue dish tags into a burrito/ribs offer and a corn-spiced
  latte without knowing the business's actual menu or capabilities.
- D2C output assumed access to behind-the-scenes footage and the show's official
  social page, and proposed unrelated third-party product giveaways/discounts
  without establishing access, budget or partnerships.
- Baselines also proposed public screenings without checking permission. Fixes
  must apply to both paths, rather than making the baseline artificially worse.
- Valid citation IDs establish that a reference exists. They do not validate
  culinary quality, a partnership, rights, feasibility or demand.

No model training is involved or necessary for the present architecture. Qloo
supplies aggregate taste evidence; an existing Groq-hosted model generates
proposals and selects tools. Evaluation and better business constraints are the
immediate needs. Training would require an appropriate labeled dataset and a
demonstrated reason to use it; neither has been established.

## Local reliability finding

The old /tmp/pulse-pg process remained alive, but a direct database query failed
because global/pg_filenode.map was missing. /board returned unavailable while
/healthz returned ok. /healthz is currently a liveness check, not proof of DB or
workflow readiness. The cause of the missing files is not established.

Restored migrations and the existing non-Qloo backup into the gitignored
services/pulse/spike/out/pgdata directory on localhost:54330. Restored 90 source
releases; no Qloo cache dump was restored. Restarted the service on 8799 with
that database via an environment override. The board responded and the two
brief/baseline pairs above completed. The old /tmp cluster is not the active
service database. Do not use the old checkpoint's 54329 recipe for this session.

## Acceptance work before public deployment

1. Diagnose sparse city ranking with controlled API requests; either demonstrate
   useful same-slate comparisons or change the central workflow and claims.
2. Constrain proposals to the owner's menu/product, budget and available assets.
   Treat partners as outreach candidates; never assume partnerships, account
   access, licensing or availability. Preserve aggregate/geographic scope.
3. Freeze representative cases before tuning: both business types and cities,
   established and current titles, unresolved/no-evidence inputs. Repeat model
   generations and compare with the same model without Qloo. Read every cited
   factual claim against its source, separately from feasibility/usefulness.
4. Have a café/food-business user review anonymized proposals. Record whether
   Qloo changes a concrete decision and why; internal model judging alone does
   not establish customer value. Do not claim a numerical improvement from
   these exploratory pairs.
5. After fixes, run relevant regression tests and complete browser guest flows,
   missing-data/provider-limit behavior, restart/recovery, actual Linux container
   execution and hosted streaming/concurrency checks. A private staging run can
   validate hosting before any public launch.

The project has a working technical foundation. A competitive product and
deployment readiness remain unproven. No push, deployment or submission occurred.

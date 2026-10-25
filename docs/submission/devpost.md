# Devpost submission draft — Release Pulse

**Draft only. Not submitted.** Replace the pending URLs and validation notes with
verified facts before publishing. Final product wording must match the deployed
revision. Do not attach raw Qloo responses, cache exports or local secret files.

## Project name

Release Pulse

## Tagline

Turn upcoming entertainment releases into evidence-backed campaign ideas for a local business.

## Inspiration / problem

A small café or food brand can see that a film is releasing this week. Deciding
whether it is a useful marketing moment—and finding an angle beyond a generic
movie pun—is harder. Release calendars answer “what is coming”; language models
can invent campaign copy. Neither alone provides the cultural evidence behind a
connection to venues, food themes, artists or brands.

We built Release Pulse to put that evidence and its limits beside the idea, so an
owner can make a decision without mistaking fluent copy for audience research.

## What it does

Choose a city and a business type: café or D2C food brand. Explore current and
upcoming titles from Spotlight’s India-first calendar, open a brief, and watch the
evidence sections arrive. A brief can include a within-city heatmap, city-filtered
venue recommendations, venue-derived food themes, global artist/food-brand
affinities, and global audience skew when available.

The campaign writer turns the available material into draft copy. Campaign clauses
link to supporting evidence IDs; unresolvable references render as **Agent
suggestion**. All campaign ideas are labelled agent proposals: a reference supplies
context, not proof of the generated wording or a promised outcome. A “Compare without Qloo” panel shows an LLM-only draft, making the
grounding difference inspectable. The in-app agent can search known releases,
read briefs and answer follow-up questions using the same bounded tools.

Filmed/set-here hooks come from a separate Wikipedia/Wikidata pipeline. They are
explicitly identified as that source, not attributed to Qloo. Thin Qloo coverage,
provider errors and pending evidence have visible states instead of invented data.

The board removes numeric scores entirely. It requests Qloo ordinal ordering
within a fixed same-type shortlist and city signal: at most ten films or ten TV
shows, with up to six film slots reserved for theatrical releases. Film and TV
queries remain separate. Omitted titles are collapsed as lacking comparable rank;
if no ranks are returned, the board labels its fallback as release order.

Live October 25 checks returned only one ranked TV title for each of the Delhi
and Mumbai current-release boards; sixteen titles lacked comparable ranks and
three did not resolve. Six theatrical candidates were present but unranked.
Established-title probes were also sparse. This is a coverage/response limitation
under investigation, not proof of rich audience comparison. Do not present the
board as a demand estimate or the suggested ordering as a forecast of campaign
effectiveness; heatmaps from separate requests are never compared.

## How Qloo changes the product

The official `@qloo/qloo-harness` runs `qloo mcp` inside our persistent Node service.
Qloo supplies cultural relationships the LLM cannot verify from the release
calendar: same-query shortlist ranks, where-popular heatmaps, place recommendations, artist/brand affinities,
entity tags and audience skew. We preserve provenance, exact query context,
timestamps and limitation text through the API and into the UI.

Identity resolution prefers TMDB → IMDb → Qloo. Two identity lookups currently use
authenticated HTTP (`/entities` and `/search`) because the pinned harness cannot
perform the required shapes; the insight workflows run through the official tool
server. We describe that boundary rather than calling the entire integration MCP.

Qloo relationships ground the evidence portion of the brief. The creative angle
and copy remain model-generated suggestions for review. City-filtered venues are
not proof that every cultural affinity is specific to that city.

## How we built it

- React/TypeScript/Vite frontend with streamed brief sections and chat.
- A separate Node 22.19+ container owns Qloo MCP and the model client.
- PostgreSQL holds catalog data, private expiring evidence caches, identity
  resolution and daily usage budgets.
- A Python ingestion worker refreshes releases and Wikipedia/Wikidata locations.
- A bounded OpenAI-compatible model client defaults to Groq; model retries,
  per-session/global budgets and Qloo request pacing constrain usage.
- Public routes validate inputs and known title IDs, enforce request limits and
  return explicit retry/unavailable states.

The frontend belongs on a separate Vercel project; the long-lived agent runs in
one container (the recommended free host may sleep). This avoids placing Qloo’s persistent tool server and
long-running streams inside Vercel serverless functions.

## What is new for this hackathon

Spotlight’s original release radar and watchlist predate September 30, 2026. The
October Release Pulse work adds `services/pulse`, migration `0016`, city
configuration, shared evidence contracts, the Pulse board/brief UI, Qloo entity
resolution and insight recipes, campaign generation, the in-app agent and the
location pipeline. The repository retains its earlier product/WebMCP history so
reviewers can distinguish the existing base from the event-period additions.

## Responsible handling and limitations

Only selected cities and cultural entity/tag IDs go to Qloo—not identities,
private watch histories, GPS trails or chat transcripts. Affinities are aggregate
relationships, not predictions about an individual. Private cache tables and raw
Qloo responses are excluded from the public repository and container context.

Demographic and artist/brand results are global; demographic values are relative
skews, not population percentages. Heatmap affinity is query-relative. Recommended
venue tags do not measure fans’ food purchases. New titles often have little
evidence; trends were empty in our original spike and are not a claimed feature.

The release calendar is India-first even for overseas cities. Wikipedia/Wikidata
coverage and title matching are incomplete. A suggested cultural connection grants
no endorsement or rights to commercial use of brands, characters or music.

We have not established sales uplift or willingness to pay in a controlled trial.
The comparison panel is a transparent product demonstration, not evidence of a
statistically measured quality improvement. API quotas can still limit simultaneous
judging traffic; paid provider access would raise some limits, not remove all caps.

## Testing instructions for judges

1. Open **[PENDING: verified hackathon frontend URL]** at
   `/pulse?city=delhi&type=cafe`; no account or API key is needed.
2. Open a release with usable evidence. Inspect source/limits labels and the links
   attached to campaign clauses.
3. Choose **Compare without Qloo**, then ask chat which claims have support.
4. Change the city/business type and inspect missing-evidence states.

The exact hosted title/city that passed the final run-through will be recorded in
`docs/submission/validation.md`. Hosting, final screenshots and clean-browser
verification remain pending; do not treat earlier local test results as hosted QA.

## Required links / publication checklist

- Functional demo: **PENDING**
- Public source repository and submitted revision: **PENDING owner confirmation**
- License: repository `LICENSE` is MIT; verify GitHub detects it in About.
- Build/reproduction: `README.md` and `docs/submission/deploy.md`.
- Final verification record and screenshot inventory: `docs/submission/validation.md`.

Demo video is not required by the current event page. The live, externally hosted
app and public licensed source are required. Confirm final requirements and
deadline on [Devpost](https://qloo.devpost.com/) before submitting. Current pages
announce November 5 finalist presentations; the team should check availability
for that appearance and preparation if selected.

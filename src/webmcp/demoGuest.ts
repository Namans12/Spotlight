/** Build-time twin of the server's `DEMO_GUEST` check (lib/usersDb.ts
 * `guestSessionsEnabled`).
 *
 * The shared demo account is one `users` row that every visitor who takes it
 * becomes — so they share a watchlist, can delete each other's items, and
 * their relation thumbs-downs land on each other. That is the right trade on
 * a hackathon deployment, where a judge or an agent has to be able to act
 * without clicking through a login first, and the wrong one on a public host.
 *
 * Both halves are needed and they do different jobs: this flag stops the
 * client from offering (or firing) an action the deployment will refuse, and
 * the server flag is what actually enforces it. A client build flag is not a
 * security boundary — never treat this one as the only check.
 *
 * Its own module, rather than an export on AutoGuestSession, so plain
 * TypeScript callers like registerTools.ts don't have to import a React
 * component to read a boolean.
 */
export const DEMO_GUEST_ENABLED = import.meta.env.VITE_DEMO_GUEST === '1';

import type postgres from "postgres";

// Read/write layer for `users` (migrations/0007_multi_user_accounts.sql).
// One row per Google account; every other per-user table (watchlist_items,
// custom_lists, user_relation_suppressions, refresh_dispatches) hangs off
// users.id via ON DELETE CASCADE.

export interface UserDTO {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

function toUserDTO(row: any): UserDTO {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
  };
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
}

/** Creates the user on first sign-in, or refreshes their profile fields on
 *  every subsequent one — a changed Google display name or photo reaches this
 *  row without a separate sync job, since sign-in already happens constantly. */
export async function upsertUserFromGoogle(sql: postgres.Sql<any>, profile: GoogleProfile): Promise<UserDTO> {
  const [row] = await sql`
    INSERT INTO users (google_id, email, display_name, avatar_url)
    VALUES (${profile.googleId}, ${profile.email}, ${profile.name}, ${profile.picture})
    ON CONFLICT (google_id) DO UPDATE SET
      email        = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      avatar_url   = EXCLUDED.avatar_url,
      updated_at   = now()
    RETURNING id, email, display_name, avatar_url
  `;
  return toUserDTO(row);
}

/** Looks up the user a session cookie names. Null if the account was deleted
 *  out from under a still-valid cookie signature. */
export async function getUserById(sql: postgres.Sql<any>, id: number): Promise<UserDTO | null> {
  const [row] = await sql`SELECT id, email, display_name, avatar_url FROM users WHERE id = ${id}`;
  return row ? toUserDTO(row) : null;
}

// Fixed, well-known google_id so every "Continue as Guest" click (including
// one made autonomously by a WebMCP tool call with no session yet) lands on
// the same one demo account, rather than minting a fresh throwaway user per
// visit. Reuses the Google upsert path since a guest is just a user row with
// no real Google identity behind it.
const GUEST_GOOGLE_ID = "webmcp-guest-demo";

/** Whether this deployment hands out the shared demo session.
 *
 *  Off unless `DEMO_GUEST=1`, because the account is *shared*: every visitor
 *  who takes it is the same user row, so they see each other's watchlist, can
 *  delete each other's items, and their relation thumbs-downs apply to each
 *  other. That is the right trade for a hackathon deployment where a judge or
 *  an agent must be able to act without clicking through a login, and the
 *  wrong one for a public host, where "private per account" has to be true.
 *
 *  Read at call time rather than module load so a test (and a serverless
 *  instance that outlives a config change) sees the current value. */
export function guestSessionsEnabled(): boolean {
  return process.env.DEMO_GUEST === "1";
}

export async function upsertGuestUser(sql: postgres.Sql<any>): Promise<UserDTO> {
  return upsertUserFromGoogle(sql, {
    googleId: GUEST_GOOGLE_ID,
    email: "guest@spotlight.demo",
    name: "Guest",
    picture: null,
  });
}

/**
 * Every profile field this app's browser code actually uses.
 *
 * public.profiles holds visible_password — a staff login's REAL password in
 * plain text. Asking for `*` from the browser returned it on every row. The
 * column-level revoke (hytek-hub/sql/2026-09-06-profiles-password-not-readable.sql)
 * takes SELECT on that column away from anon and authenticated, which means a
 * browser asking for `*` is refused OUTRIGHT — not quietly given fewer columns.
 *
 * So this list is not tidiness. Any browser query naming `*` against profiles
 * breaks sign-in the moment that revoke is applied. Name the columns.
 */
export const PROFILE_BROWSER_COLUMNS = 'id, email, full_name, role, created_at'

# ZIS Solar security review — 2026-09-08

Scope: application source, authentication/session lifecycle, administrator/viewer authorization, tenant scoping, input handling, dependency audit, browser security headers, client artifacts, and the Neon runtime database role. This is a targeted code and integration review, not a certification or a guarantee that no vulnerability exists.

## Remediation

- Updated the vulnerable transitive Undici package. `npm audit` and `npm audit --omit=dev` now report zero known vulnerabilities.
- Added per-request random CSP nonces, strict script execution policy, blocked framing, off-site form submissions and external browser connections. Inline CSS remains enabled for charts and accessible popup positioning; inline scripts require a nonce. Client-provided nonce headers are overwritten.
- Added HTTPS/HSTS and indexing restrictions. Authenticated/API responses use `private, no-store`.
- Login is limited by both trusted Vercel client IP (30 attempts/15 minutes) and normalized account name (10 attempts/15 minutes). Account limits reset after successful authentication; the IP budget does not. Password/user management limits remain in place; solar mutations are limited to 120 requests/15 minutes per administrator.
- JSON input is bounded while streaming, including missing or inaccurate Content-Length. Reject invalid UTF-8, invalid JSON, arrays/null/scalars and non-JSON content types.
- Session creation rechecks the password hash and active state in the INSERT, preventing a login checked against an old password from issuing a new session after a concurrent reset. Session tokens are random, stored hashed, and delivered through HttpOnly/Secure/SameSite cookies. Existing sessions remain compatible.
- Added server-only import boundaries for database and collector modules. Removed full database errors from solar route logs.
- Replaced all database credential aliases in Vercel Production/Development with a restricted `zis_app_runtime` role. It has no superuser, role/database creation, schema creation or RLS bypass rights. It cannot DELETE readings or UPDATE historical revision tables. Required table grants are explicit; future schema migrations require the separately retained maintenance credentials and deliberate grants.
- Moved the pre-existing plaintext credential file out of the workspace/OneDrive to the local private ZisSolar directory and added Git ignore rules. This does not erase prior OneDrive versions or backups.

## Verification

- 21 unit tests pass, including new streaming byte limits, invalid JSON and CSP tests.
- Production build and TypeScript checks pass.
- Integration tests with temporary isolated owners and users pass: viewer mutation denial, role escalation denial, cross-owner access denial, protected primary owner, password reset, disabled login, role changes, immediate session revocation and logout invalidation. Fixtures are removed in finally blocks. Repeated against the restricted database runtime role.
- HTTP tests pass for anonymous API denial, fake session denial, CSRF rejection, private-file 404s, no-store headers, unique/non-spoofable nonces, oversized bodies and login throttling. Brute-force threshold tests run only against the local test server.
- The database secret values available to this audit were not found in tracked files, Git patch history, or built client bundles. Huawei and cron credentials were not returned by the environment export and were not value-matched by this scan. This does not prove that every historical or unknown secret is absent.
- Production checks: login responds 200; unauthenticated solar/users/cron APIs respond 401; private credential paths return 404. Browser hydration, graph selection and theme switching work with enforced CSP and no recorded browser errors. The scheduled collector completed successfully at 15:06 UTC, after the 15:05 UTC deployment became ready.

## Operational limits and follow-up

- Account security at Vercel, Neon, Huawei and the user's computer remains a separate boundary. MFA/recovery settings and actual backup restoration were not verified by these application tests.
- Application login remains password based; no MFA was introduced in this change.
- Rate limits reduce application abuse but are not a replacement for provider-level DDoS protection.
- Historic Vercel deployments retain their original code/environment snapshot. The project has Vercel SSO protection configured as `all_except_custom_domains` and directory listing disabled. Retire obsolete deployments as part of release maintenance; a code update does not retroactively modify their snapshots.
- Keep maintenance database credentials outside application deployments. Do not run schema migrations with the runtime role or broaden its permissions to make a migration pass.
- No destructive penetration tests, third-party infrastructure scans, or production user password resets were performed.

Design references: [Next.js CSP](https://nextjs.org/docs/app/guides/content-security-policy), [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Neon PostgreSQL roles](https://neon.com/docs/reference/compatibility).

# CLAUDE.md: rules for working on FairShare Solar

`SPEC.md` is the source of truth. Read it before each milestone. `DECISIONS.md` records where the build intentionally differs from it, and why.

## How to work
- Work **one milestone at a time** (SPEC.md §11). Don't start the next milestone until the user says so.
- Before each commit, run all three of these and commit only when **all are green**:
  - `npm.cmd run lint`
  - `npm.cmd run typecheck`
  - `npm.cmd test`
- Add a short entry for the milestone to `DECISIONS.md` (decisions made, deviations, anything surprising).
- **Never skip, delete or weaken a test to make it pass.** Fix the code, or stop and report.
- Install only the versions pinned in SPEC.md §5.1. **No new dependencies** outside the spec.
- No third-party company or product names or branding anywhere except the README's "Why I built this" section (SPEC.md §1, "Independence and branding rules").

## Hands off
- Never touch `.env` files (`api/.env`, `api/.env.test`).
- Never use the `postgres` superuser.
- Never touch `fairshare_dev` data except through the app itself: the seed (`npm.cmd run db:seed`) and normal simulator use (start/stop, split-mode changes from the dashboard or API) are allowed. No manual SQL, deletes or truncates there.
- Only stop processes you started yourself, **by the PID you recorded when starting them**. Never kill by name or command-line pattern, or by whoever owns a port. Stop your own dev servers before `prisma generate` (they lock the query engine DLL). If someone else's process is in the way, ask.
- Never push, never run `git config`, never rewrite history (no amend, rebase, reset --hard or force).
- Commands written for the user use `npm.cmd` / `npx.cmd` (their PowerShell blocks `npm.ps1`).

## Stop and report when
1. The same step fails twice.
2. You need a secret, the user's consent (for example a Prisma consent prompt), or a database reset.
3. You want to add a dependency or change a version.
4. You want to change an API shape, the scope, or a rule in the spec. A small fix proven by a test is fine if it is recorded in `DECISIONS.md` (as in ADR-007).
5. You reach a milestone gate the user has set.

When stopping, say what you were doing, what failed or what you need, and what you'd suggest.

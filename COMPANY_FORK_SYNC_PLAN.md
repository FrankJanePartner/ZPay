# Verified company-fork synchronization procedure

**Scope:** Prepare the synchronization procedure only. Do not merge, push or deploy automatically. The company repository remains unchanged until explicit owner approval.

## Repository identity verified through GitHub

- Personal source: `FrankJanePartner/ZPay`, branch `main`.
- Audit changes: `FrankJanePartner/ZPay`, branch `audit/security-hardening-2026-10`; draft PR #5.
- Company destination: `ZOERDHUB/ZPay`, branch `main`.
- GitHub branch lookup confirmed both repositories expose a `main` branch.
- At preparation time, comparing the personal `main` to its audit branch showed **74 commits ahead, 0 behind**. These audit commits are **not** on personal main. This count will change with future commits.
- **Not verified:** the company fork's relationship to personal main; a self-comparison of company main does not establish ancestry. Confirm the fork relationship and compare the actual branch SHAs before syncing.

## Required gates (in order)

1. Finish all mandatory backend, frontend, Rust and wallet-service CI checks, wallet integration tests, security remediation and review.
2. Verify the audit PR's exact commit SHA and ensure personal main has not moved unexpectedly.
3. Obtain explicit approval to merge PR #5 into `FrankJanePartner/ZPay:main`. Merge only after all checks pass.
4. Confirm company `ZOERDHUB/ZPay:main` base SHA and compare it with the approved personal main SHA. If diverged, inspect commits and resolve conflicts in a **new company-side PR**. Never force-push or overwrite company work.
5. Obtain explicit approval for the company synchronization. Create a company-side sync branch/PR targeting `ZOERDHUB/ZPay:main`; review changes, secrets, migrations, build assets and CI.
6. Merge the company PR only after its own required checks and approval. Verify company main's final SHA, then run deployment-specific validation separately.

## Example commands (manual; review before use)

```bash
git clone https://github.com/FrankJanePartner/ZPay.git
cd ZPay
git fetch origin
git checkout main
git pull --ff-only origin main
git remote add company https://github.com/ZOERDHUB/ZPay.git
git fetch company
git log --oneline --left-right company/main...origin/main
git diff --stat company/main...origin/main
# STOP: do not push until the audit PR is merged and company sync is approved.
```

After approval, create a sync branch from company main and merge/cherry-pick approved personal changes with conflict review, then push that branch to an authorized remote and open a PR. **Never** use `git push --force` or push directly to company main.

## Secrets and operational safety

Do not copy local `.env`, seed phrases, recovery material, wallet databases or signing keys. Check CI secrets and deployment settings in the company environment independently. Confirm Django database migrations, Tauri signing and wallet history schema compatibility before release.

**Checklist accounting:** This procedure completes milestone 15 task **Prepare verified sync instructions** only. **Synchronize company fork with approval** and **Confirm company fork checks** remain unchecked.

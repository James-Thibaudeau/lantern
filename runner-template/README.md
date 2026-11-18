# Lantern runner

Private runner for [Lantern](https://github.com/James-Thibaudeau/lantern). It holds your watchlist and job-search profiles, and a workflow that calls Lantern's reusable `ingest.yml` once a day. Fetched jobs land as workflow artifacts (`ingest-<run id>`), which the local Lantern app pulls in with `pnpm sync` (or its Sync button).

Keep this repo **private**: your config, logs and artifacts then stay private without any secrets or masking.

## Setup

From a Lantern checkout, with the GitHub CLI signed in:

```bash
pnpm cli init-runner my-lantern-runner
```

That copies this folder to `../my-lantern-runner`, turns the example configs into real ones, and pushes it to a new private repo. Pushing workflow files needs the `workflow` scope on your `gh` token (`gh auth refresh -s workflow`).

Then edit `config/companies.json` and `config/profiles.json`, commit, push, and try a run:

```bash
gh workflow run run.yml -f dryRun=true
```

## Files

| Path                        | What it is                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.github/workflows/run.yml` | Daily schedule plus a manual trigger. Calls `James-Thibaudeau/lantern/.github/workflows/ingest.yml@v1`     |
| `config/companies.json`     | Watchlist: `{ name, ats, slug, workday?: { tenant, host, site } }[]`                                       |
| `config/profiles.json`      | Profiles for the early filter: `id`, `enabled`, `titleInclude[]`, `titleExclude[]`, `allowedEligibility[]` |

## Running

- **Daily:** 11:17 UTC. Change the `cron:` line in `run.yml` to suit you.
- **Manually:** Actions → Ingest jobs → Run workflow, or `gh workflow run run.yml`.

| Input        | Effect                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| `companies`  | Fetch only these slugs. Jobs from the other companies are left as they were          |
| `dryRun`     | Produce `report.json` only. Sync ignores the run and the seen-jobs state isn't saved |
| `fullResend` | Ignore the saved state and resend every job that passes the filter                   |

## Config

### `companies.json`

`ats` is one of `greenhouse`, `lever`, `ashby` (supported now), `workday`, `bamboohr` (coming later; such companies are skipped until then). `slug` is the board name in the job-board URL, for example `gitlab` in `boards.greenhouse.io/gitlab`.

### `profiles.json`

- `titleInclude` / `titleExclude`: case-insensitive whole words or phrases (so `intern` doesn't match "International"). A job is kept if its title matches at least one `titleInclude` of an enabled profile, none of that profile's `titleExclude`, and its eligibility is in that profile's `allowedEligibility`.
- `allowedEligibility`: any of `canada_onsite`, `canada_hybrid`, `remote_canada_ok`, `remote_us_only`, `remote_non_canada`, `non_canada_onsite`, `unknown`. Keep `unknown`, since the local LLM pass resolves those.

## Upgrading Lantern

When a new Lantern version is tagged, update both the `@vN` in `uses:` and `lantern_ref: vN` in `run.yml`, in the same commit.

## Local sync token

The Lantern app needs a fine-grained personal access token scoped to **this repo only**, with:

- **Actions:** read and write (sync, Run now, Full resend)
- **Contents:** read and write (editing config from the app)

Put it in Lantern's local `.env`, never in this repo.

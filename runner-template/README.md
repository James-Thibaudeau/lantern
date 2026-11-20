# Lantern runner

Private runner for [Lantern](https://github.com/James-Thibaudeau/lantern). It holds your watchlist and job-search profiles, and a workflow that calls Lantern's reusable `ingest.yml` once a day. Fetched jobs land as workflow artifacts (`ingest-<run id>`), which the local Lantern app pulls in with `pnpm sync` (or its Sync button).

Keep this repo **private**: your config, logs and artifacts then stay private without any secrets or masking.

## Setup

From a Lantern checkout, with the GitHub CLI signed in:

```bash
pnpm cli init-runner my-lantern-runner
```

That copies this folder to `../my-lantern-runner`, turns the example configs into real ones, and pushes it to a new private repo. Pushing workflow files needs the `workflow` scope on your `gh` token (`gh auth refresh -s workflow`).

Then edit `config/companies.json`, `config/profiles.json`, `config/criteria.json` and `config/resume.json`, commit, push, and try a run:

```bash
gh workflow run run.yml -f dryRun=true
```

## Files

| Path                        | What it is                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.github/workflows/run.yml` | Daily schedule plus a manual trigger. Calls `James-Thibaudeau/lantern/.github/workflows/ingest.yml@v1`     |
| `config/companies.json`     | Watchlist: `{ name, ats, slug, region?: "eu", workday?: { tenant, host, site } }[]`                        |
| `config/profiles.json`      | Profiles for the early filter: `id`, `enabled`, `titleInclude[]`, `titleExclude[]`, `allowedEligibility[]` |
| `config/criteria.json`      | Ranking for the app: `signals[]`, `dealbreakers[]`, `eligibility` points, `salary` floor                   |
| `config/resume.json`        | Your master resume for tailoring: basics, summary, skill groups, jobs with bullet `id`s                    |

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

`ats` is one of `greenhouse`, `lever`, `ashby`, `workable`, `recruitee` (supported), or `workday`, `bamboohr` (skipped: Workday's career sites block scripted clients, and BambooHR isn't built yet). A Lever board on `jobs.eu.lever.co` also needs `"region": "eu"`; `pnpm cli detect-ats <url> --add` fills that in. `slug` is the board name in the job-board URL, for example `gitlab` in `boards.greenhouse.io/gitlab`.

### `profiles.json`

- `titleInclude` / `titleExclude`: case-insensitive whole words or phrases (so `intern` doesn't match "International"). A job is kept if its title matches at least one `titleInclude` of an enabled profile, none of that profile's `titleExclude`, and its eligibility is in that profile's `allowedEligibility`.
- `allowedEligibility`: any of `canada_onsite`, `canada_hybrid`, `remote_canada_ok`, `remote_us_only`, `remote_non_canada`, `non_canada_onsite`, `unknown`. Keep `unknown`, since the local LLM pass resolves those.

### `criteria.json`

Ranking for the Lantern app: weighted `signals`, `dealbreakers`, points per `eligibility` and an optional `salary` floor. It's read on your laptop, not in the Action, so it can change without a run. See "Ranking" in Lantern's README.

### `resume.json`

Your master resume, which the Lantern app tailors to each job on your laptop (never in the Action). Every job and bullet has an `id` (lowercase, digits, dashes) so a tailored bullet can point back at its original. Tailoring only selects, reorders and lightly rewords what's here, so keep it complete and accurate. See "Tailoring" in Lantern's README.

## Upgrading Lantern

When a new Lantern version is tagged, update both the `@vN` in `uses:` and `lantern_ref: vN` in `run.yml`, in the same commit.

## Local sync token

The Lantern app needs a fine-grained personal access token scoped to **this repo only**, with:

- **Actions:** read and write (sync, Run now, Full resend)
- **Contents:** read and write (editing config from the app)

Put it in Lantern's local `.env`, never in this repo.

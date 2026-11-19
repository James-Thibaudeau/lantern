import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Jobs synced from ingest runs.
 *
 * Column ownership: sync owns the source fields plus firstSeenAt, lastSeenAt, closedAt and
 * lastRunId. `status`, `notes` and `appliedResumeId` are local-only; sync never touches them.
 * Timestamps are ISO 8601 strings.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    source: text('source').notNull(),
    sourceJobId: text('source_job_id').notNull(),
    companySlug: text('company_slug').notNull(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    applyUrl: text('apply_url'),
    locationText: text('location_text').notNull(),
    country: text('country'),
    workplaceType: text('workplace_type'),
    eligibility: text('eligibility').notNull(),
    salaryMin: real('salary_min'),
    salaryMax: real('salary_max'),
    salaryCurrency: text('salary_currency'),
    salaryPeriod: text('salary_period'),
    descriptionHtml: text('description_html').notNull(),
    descriptionText: text('description_text').notNull(),
    postedAt: text('posted_at'),
    updatedAt: text('updated_at'),
    contentHash: text('content_hash').notNull(),

    // Set by sync.
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    /** Set when a complete fetch of the company no longer lists the job; cleared if it comes back. */
    closedAt: text('closed_at'),
    lastRunId: text('last_run_id').notNull(),

    // Local only.
    status: text('status').notNull().default('new'),
    notes: text('notes'),
    /** tailored_resumes.id of the version you applied with. */
    appliedResumeId: integer('applied_resume_id'),
  },
  (t) => [
    index('jobs_company_open_idx').on(t.companySlug, t.closedAt),
    index('jobs_dedupe_idx').on(t.dedupeKey),
  ],
)

/** One row per runner workflow run that sync has looked at. */
export const ingestRuns = sqliteTable('ingest_runs', {
  runId: text('run_id').primaryKey(),
  runCreatedAt: text('run_created_at').notNull(),
  syncedAt: text('synced_at').notNull(),
  /**
   * synced: applied. no_artifact: a dry run or other run without results.
   * expired: results were deleted before sync got to them (a gap).
   * superseded: older than a run already synced, so applying it would undo newer data.
   */
  outcome: text('outcome', { enum: ['synced', 'no_artifact', 'expired', 'superseded'] }).notNull(),
  received: integer('received').notNull().default(0),
  inserted: integer('inserted').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  closed: integer('closed').notNull().default(0),
  reopened: integer('reopened').notNull().default(0),
  /** Open jobs listed by the run that aren't in the local DB: a sign of a missed run. */
  missing: integer('missing').notNull().default(0),
  /** report.json from the run, as JSON text. */
  report: text('report'),
})

/** Latest known state of each watched company, from run reports. */
export const companies = sqliteTable('companies', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  ats: text('ats').notNull(),
  lastRunId: text('last_run_id').notNull(),
  lastRunAt: text('last_run_at').notNull(),
  lastStatus: text('last_status').notNull(),
  lastComplete: integer('last_complete', { mode: 'boolean' }).notNull(),
  lastFetched: integer('last_fetched').notNull(),
  lastKept: integer('last_kept').notNull(),
  lastError: text('last_error'),
})

export type JobRowDb = typeof jobs.$inferSelect
export type IngestRunRow = typeof ingestRuns.$inferSelect
export type CompanyRow = typeof companies.$inferSelect

/** Companies suggested for the watchlist (HN miner, detect-ats), waiting for a decision. */
export const suggestions = sqliteTable(
  'suggestions',
  {
    /** "<ats>:<slug>", lowercased slug. */
    id: text('id').primaryKey(),
    ats: text('ats').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** The companies.json entry to add, as JSON; null when we can't read this board yet. */
    company: text('company'),
    supported: integer('supported', { mode: 'boolean' }).notNull(),
    note: text('note'),
    /** How the board was found: linked directly, found on the company's page, or guessed. */
    via: text('via', { enum: ['link', 'page', 'guess'] }).notNull(),
    source: text('source', { enum: ['hn', 'url'] }).notNull(),
    sourceUrl: text('source_url'),
    /** The HN post's first line, or the URL given to detect-ats. */
    sourceText: text('source_text'),
    openJobs: integer('open_jobs'),
    matchingJobs: integer('matching_jobs'),
    checkError: text('check_error'),
    checkedAt: text('checked_at').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: text('created_at').notNull(),
    decidedAt: text('decided_at'),
  },
  (t) => [index('suggestions_status_idx').on(t.status)],
)

export type SuggestionRow = typeof suggestions.$inferSelect

/**
 * Tailored resume versions per job (1, 2, 3… per job). JSON columns are stored as text;
 * callers validate them with their own schemas.
 */
export const tailoredResumes = sqliteTable(
  'tailored_resumes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    version: integer('version').notNull(),
    createdAt: text('created_at').notNull(),
    model: text('model').notNull(),
    resumeHash: text('resume_hash').notNull(),
    jobHash: text('job_hash').notNull(),
    /** The tailoring, as JSON. */
    tailoring: text('tailoring').notNull(),
    /** Checks run on the tailoring, as JSON. */
    checks: text('checks').notNull(),
    /** JSON object: change key → accepted. */
    decisions: text('decisions').notNull().default('{}'),
    /** Token usage, as JSON. */
    usage: text('usage'),
  },
  (t) => [uniqueIndex('tailored_resumes_job_version_idx').on(t.jobId, t.version)],
)

export type TailoredResumeRow = typeof tailoredResumes.$inferSelect

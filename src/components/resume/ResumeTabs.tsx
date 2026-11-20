import { Link } from '@tanstack/react-router'

const tab =
  'border-b-2 px-3 py-2 text-sm whitespace-nowrap border-transparent text-muted hover:text-ink'
const active = '!border-accent-500 font-medium !text-ink'

/** The Resume page's two views: the master resume and the tailoring prompt. */
export function ResumeTabs() {
  return (
    <nav aria-label="Resume" className="-mt-2 mb-6 flex gap-1 border-b border-line">
      <Link
        to="/resume"
        className={tab}
        activeProps={{ className: active }}
        activeOptions={{ exact: true }}
      >
        Master resume
      </Link>
      <Link to="/resume/prompt" className={tab} activeProps={{ className: active }}>
        Tailoring prompt
      </Link>
    </nav>
  )
}

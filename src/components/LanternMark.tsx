/** Lantern's mark: a small lantern with a lit flame. Decorative; label the text next to it. */
export function LanternMark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M9 3.5h6M12 2v1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M7.5 6.5h9l-.6 11.2a1.5 1.5 0 0 1-1.5 1.4H9.6a1.5 1.5 0 0 1-1.5-1.4L7.5 6.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6.5 6.5h11M8 21h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M12 9.2c1.4 1.5 2.1 2.7 2.1 3.8a2.1 2.1 0 1 1-4.2 0c0-1.1.7-2.3 2.1-3.8Z"
        className="fill-accent-500"
      />
    </svg>
  )
}

/** The same mark as a data: URL, for the favicon. */
export const LANTERN_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#44403c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 3.5h6M12 2v1.5M6.5 6.5h11M8 21h8"/>' +
      '<path d="M7.5 6.5h9l-.6 11.2a1.5 1.5 0 0 1-1.5 1.4H9.6a1.5 1.5 0 0 1-1.5-1.4L7.5 6.5Z"/>' +
      '<path d="M12 9.2c1.4 1.5 2.1 2.7 2.1 3.8a2.1 2.1 0 1 1-4.2 0c0-1.1.7-2.3 2.1-3.8Z" fill="#10b981" stroke="none"/>' +
      '</svg>',
  )

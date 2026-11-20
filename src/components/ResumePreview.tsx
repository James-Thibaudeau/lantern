import { useEffect, useRef, useState } from 'react'

/** The rendered resume, scaled to fit the pane. Sandboxed: no scripts, no shared styles. */
export function ResumePreview({ html, title }: { html: string; title: string }) {
  const PAGE = 860 // the resume's own width (8.5in) plus its margin
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(1100)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / PAGE))
    })
    if (box.current) observer.observe(box.current)
    return () => observer.disconnect()
  }, [])

  function measure() {
    const doc = frame.current?.contentDocument
    if (doc) setHeight(doc.documentElement.scrollHeight)
  }

  return (
    <div
      ref={box}
      className="overflow-hidden rounded-lg border border-line bg-[#c9ccd3]"
      style={{ height: height * scale }}
    >
      <iframe
        ref={frame}
        title={title}
        srcDoc={html}
        // allow-same-origin (without allow-scripts) only lets us measure the page's height.
        sandbox="allow-same-origin"
        onLoad={measure}
        className="origin-top-left border-0"
        style={{ width: PAGE, height, transform: `scale(${scale})` }}
      />
    </div>
  )
}

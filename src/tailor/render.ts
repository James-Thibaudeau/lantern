import type { JobEntry, Resume } from './resume'

// Renders a resume as one standalone HTML file in the style of the hand-made resume it
// replaces: letter-size, Montserrat, a blue accent, and print rules so ⌘P gives a clean PDF.
// The in-app preview, the printable page and the downloaded file all come from here.

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Only http(s) and mailto links make it into the page. */
const safeUrl = (url: string) => (/^(https?:|mailto:)/i.test(url) ? esc(url) : '#')

const STYLE = `
  :root {
    --blue: #004aad; --ink: #26262b; --text: #3d3d44; --muted: #6b6b74;
    --rule: #d5d9e3; --paper: #ffffff; --desk: #c9ccd3;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: var(--desk); }
  body {
    font-family: "Montserrat", Arial, sans-serif; font-size: 9.2pt; line-height: 1.42;
    color: var(--text); padding: 24px 16px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  a { color: inherit; }
  .sheet {
    max-width: 8.5in; margin: 0 auto; background: var(--paper);
    padding: 0.55in 0.6in; box-shadow: 0 2px 12px rgba(0,0,0,.25);
  }
  header { border-bottom: 2pt solid var(--blue); padding-bottom: 10pt; }
  h1 {
    font-size: 22pt; font-weight: 700; letter-spacing: 1.5pt; line-height: 1.1;
    color: var(--blue); text-transform: uppercase;
  }
  .headline { margin-top: 3pt; font-size: 11pt; font-weight: 500; color: var(--ink); }
  .contact {
    margin-top: 7pt; display: flex; flex-wrap: wrap; gap: 2pt 0; list-style: none;
    font-size: 8.6pt; color: var(--muted);
  }
  .contact li + li::before { content: "·"; margin: 0 7pt; color: var(--rule); font-weight: 700; }
  .contact a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
  section { margin-top: 13pt; }
  h2 {
    font-size: 9.6pt; font-weight: 700; letter-spacing: 1.2pt; text-transform: uppercase;
    color: var(--blue); padding-bottom: 3pt; border-bottom: 1px solid var(--rule); margin-bottom: 7pt;
  }
  .summary { color: var(--text); }
  .skills { display: grid; grid-template-columns: 92pt 1fr; row-gap: 2.5pt; }
  .skills dt { font-weight: 600; color: var(--ink); }
  .job + .job { margin-top: 11pt; }
  .job-head {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12pt;
    break-after: avoid; page-break-after: avoid;
  }
  .role { font-weight: 700; color: var(--ink); font-size: 9.8pt; }
  .company { font-weight: 600; color: var(--ink); }
  .role .sep { color: var(--muted); font-weight: 400; margin: 0 3pt; }
  .dates { font-weight: 600; color: var(--ink); white-space: nowrap; }
  .context { color: var(--muted); font-size: 8.6pt; margin-top: 1pt; }
  ul.bullets { margin-top: 4pt; padding-left: 12pt; }
  ul.bullets li { padding-left: 2pt; margin-top: 2.5pt; break-inside: avoid; page-break-inside: avoid; }
  ul.bullets li::marker { color: var(--blue); }
  .stack { margin-top: 3pt; font-size: 8.4pt; color: var(--muted); break-before: avoid; page-break-before: avoid; }
  .stack b { font-weight: 600; color: var(--text); }
  ul.bullets li:last-child { break-after: avoid; page-break-after: avoid; }
  .compact { margin-top: 11pt; }
  .compact .job-head { margin-top: 3pt; }
  .compact .job + .job { margin-top: 5pt; }
  .edu { display: flex; justify-content: space-between; gap: 12pt; }
  .edu + .edu { margin-top: 3pt; }
  .edu strong { font-weight: 600; color: var(--ink); }
  @page { size: letter; margin: 0.5in 0.6in; }
  @media print {
    html { background: none; }
    body { padding: 0; }
    .sheet { box-shadow: none; padding: 0; max-width: none; }
    a { text-decoration: none; }
  }
  @media screen and (max-width: 640px) {
    body { padding: 0; }
    .sheet { padding: 24px 16px; box-shadow: none; }
    .job-head, .edu { flex-direction: column; gap: 0; }
    .skills { grid-template-columns: 1fr; }
    .skills dd { margin-bottom: 4pt; }
  }
`

function job(j: JobEntry, indent: string): string {
  const lines = [
    `${indent}<article class="job">`,
    `${indent}  <div class="job-head">`,
    `${indent}    <div class="role">${esc(j.title)}<span class="sep">|</span><span class="company">${esc(j.employer)}</span></div>`,
    `${indent}    <div class="dates">${esc(j.dates)}</div>`,
    `${indent}  </div>`,
  ]
  if (j.context) lines.push(`${indent}  <div class="context">${esc(j.context)}</div>`)
  if (j.bullets.length > 0) {
    lines.push(`${indent}  <ul class="bullets">`)
    for (const b of j.bullets) lines.push(`${indent}    <li>${esc(b.text)}</li>`)
    lines.push(`${indent}  </ul>`)
  }
  if (j.stack.length > 0) {
    lines.push(`${indent}  <p class="stack"><b>Stack:</b> ${esc(j.stack.join(', '))}</p>`)
  }
  lines.push(`${indent}</article>`)
  return lines.join('\n')
}

export interface RenderOptions {
  /** The page title, e.g. "Jane Doe – Acme – Frontend Engineer". Defaults to "<name> Resume". */
  title?: string
}

/** A complete HTML document. Every string from the resume is escaped. */
export function renderResume(r: Resume, opts: RenderOptions = {}): string {
  const b = r.basics
  const contact = [
    b.location && `<li>${esc(b.location)}</li>`,
    b.phone && `<li>${esc(b.phone)}</li>`,
    b.email && `<li><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></li>`,
    ...b.links.map((l) => `<li><a href="${safeUrl(l.url)}">${esc(l.label)}</a></li>`),
  ].filter(Boolean)

  const full = r.experience.filter((j) => !j.compact)
  const compact = r.experience.filter((j) => j.compact)

  const sections: string[] = [
    `  <section>\n    <h2>Summary</h2>\n    <p class="summary">${esc(r.summary)}</p>\n  </section>`,
  ]
  if (r.skills.length > 0) {
    const rows = r.skills
      .map((g) => `      <dt>${esc(g.group)}</dt>\n      <dd>${esc(g.items.join(', '))}</dd>`)
      .join('\n')
    sections.push(
      `  <section>\n    <h2>Skills</h2>\n    <dl class="skills">\n${rows}\n    </dl>\n  </section>`,
    )
  }
  const jobs = full.map((j) => job(j, '    '))
  if (compact.length > 0) {
    jobs.push(
      `    <div class="compact">\n${compact.map((j) => job(j, '      ')).join('\n')}\n    </div>`,
    )
  }
  sections.push(`  <section>\n    <h2>Experience</h2>\n\n${jobs.join('\n\n')}\n  </section>`)
  if (r.patents.length > 0) {
    const items = r.patents
      .map((p) => {
        const title = p.url ? `<a href="${safeUrl(p.url)}">${esc(p.title)}</a>` : esc(p.title)
        return `    <p>${title}${p.number ? ` (${esc(p.number)})` : ''}</p>`
      })
      .join('\n')
    sections.push(
      `  <section>\n    <h2>${r.patents.length === 1 ? 'Patent' : 'Patents'}</h2>\n${items}\n  </section>`,
    )
  }
  if (r.education.length > 0) {
    const items = r.education
      .map(
        (e) =>
          `    <div class="edu"><span><strong>${esc(e.credential)}</strong>, ${esc(e.school)}</span><span>${esc(e.year)}</span></div>`,
      )
      .join('\n')
    sections.push(`  <section>\n    <h2>Education</h2>\n${items}\n  </section>`)
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title ?? `${b.name} Resume`)}</title>
<meta name="description" content="${esc(`${b.name}, ${b.headline}`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<main class="sheet">

  <header>
    <h1>${esc(b.name)}</h1>
    <div class="headline">${esc(b.headline)}</div>
    <ul class="contact">
${contact.map((c) => `      ${c}`).join('\n')}
    </ul>
  </header>

${sections.join('\n\n')}

</main>
</body>
</html>
`
}

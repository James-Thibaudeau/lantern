import { createFileRoute } from '@tanstack/react-router'

// A tailored resume as its own HTML document, outside the app: open it to read it full size
// and print it to PDF, or add ?download=1 to save it as a file.
export const Route = createFileRoute('/print/resume/$tailoredId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const id = Number(params.tailoredId)
        // Imported here so the database code stays on the server.
        const { printableResume } = await import('#/server/tailoring')
        const resume = Number.isInteger(id) ? printableResume(id) : null
        if (!resume) return new Response('Tailored resume not found', { status: 404 })
        const download = new URL(request.url).searchParams.has('download')
        const headers: Record<string, string> = {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        }
        if (download) {
          headers['Content-Disposition'] =
            `attachment; filename*=UTF-8''${encodeURIComponent(resume.fileName)}`
        }
        return new Response(resume.html, { headers })
      },
    },
  },
})

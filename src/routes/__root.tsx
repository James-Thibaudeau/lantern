import { TanStackDevtools } from '@tanstack/react-devtools'
import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

import { AppShell } from '#/components/AppShell'
import { LANTERN_FAVICON } from '#/components/LanternMark'
import { EmptyState, buttonClass } from '#/components/ui'
import { getShell } from '#/server/shell'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Lantern',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      { rel: 'icon', href: LANTERN_FAVICON },
    ],
  }),
  // Sidebar data. Runs on every navigation, so its counts follow your changes.
  loader: () => getShell(),
  shellComponent: RootDocument,
  component: AppShell,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <EmptyState title="Page not found">
        <Link to="/jobs" className={`mt-3 ${buttonClass('secondary')}`}>
          Go to jobs
        </Link>
      </EmptyState>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

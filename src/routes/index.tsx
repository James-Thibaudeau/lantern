import { createFileRoute, redirect } from '@tanstack/react-router'

// Jobs is the home page.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/jobs' })
  },
})

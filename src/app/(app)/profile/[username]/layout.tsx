import type { Metadata } from 'next'

type Props = {
  params: Promise<{ username: string }>
}

// The username is already in the URL and on the page, so the tab can carry it
// without a query. The root layout's template adds " · InvestTracker".
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params
  return { title: `@${decodeURIComponent(username)}` }
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}

import type { ReactNode } from 'react'
import SiteFooter from './SiteFooter'
import SiteHeader from './SiteHeader'

type AppLayoutProps = {
  children: ReactNode
}

function AppLayout({ children }: AppLayoutProps) {
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  )
}

export default AppLayout

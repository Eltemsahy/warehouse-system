import ArrowIcon from '../ui/ArrowIcon'
import BrandMark from '../ui/BrandMark'

function SiteHeader() {
  return (
    <header className="mx-auto flex h-[76px] w-[min(100%-40px,1328px)] items-center justify-between border-b border-line md:h-[86px] md:w-[min(100%-112px,1328px)]">
      <a
        className="flex items-center gap-2 font-display text-[23px] font-extrabold tracking-[-1.4px] text-green no-underline"
        href="#top"
        aria-label="Cargo home"
      >
        <BrandMark />
        <span>
          cargo<span className="text-orange">.</span>
        </span>
      </a>

      <nav
        className="ml-auto mr-5 hidden items-center gap-6 md:mr-10 md:flex md:gap-9"
        aria-label="Main navigation"
      >
        <a className="text-sm font-medium text-[#545d56] transition-colors hover:text-green" href="#platform">
          Platform
        </a>
        <a className="text-sm font-medium text-[#545d56] transition-colors hover:text-green" href="#workflow">
          How it works
        </a>
        <a className="text-sm font-medium text-[#545d56] transition-colors hover:text-green" href="#about">
          About
        </a>
      </nav>

      <a
        className="inline-flex min-h-10 items-center gap-2 rounded border border-[#dcded7] px-3 text-xs font-semibold text-ink no-underline transition-colors hover:border-green hover:text-green md:min-h-11 md:gap-2.5 md:px-4 md:text-sm"
        href="#platform"
      >
        Explore the platform
        <ArrowIcon className="h-3.5 w-3.5 md:h-4 md:w-4" />
      </a>
    </header>
  )
}

export default SiteHeader

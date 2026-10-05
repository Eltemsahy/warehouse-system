import ArrowIcon from '../ui/ArrowIcon'
import BrandMark from '../ui/BrandMark'

function SiteFooter() {
  return (
    <footer className="mx-auto mt-7 flex min-h-[78px] w-[min(100%-40px,1328px)] flex-wrap items-center justify-between gap-2 border-t border-line py-4 md:w-[min(100%-112px,1328px)] md:flex-nowrap md:gap-5">
      <a
        className="flex items-center gap-2 font-display text-lg font-extrabold tracking-[-1px] text-green no-underline"
        href="#top"
        aria-label="Cargo home"
      >
        <BrandMark className="h-[27px] w-[27px]" />
        <span>
          cargo<span className="text-orange">.</span>
        </span>
      </a>
      <span className="order-1 w-full text-xs text-[#858a82] md:order-none md:w-auto">
        A steadier way to keep goods moving.
      </span>
      <a
        className="inline-flex items-center gap-1 text-xs text-[#858a82] no-underline hover:text-green"
        href="https://github.com/Eltemsahy/warehouse-system"
        target="_blank"
        rel="noreferrer"
      >
        Built for the work behind the workflow
        <ArrowIcon diagonal className="h-3 w-3" />
      </a>
    </footer>
  )
}

export default SiteFooter

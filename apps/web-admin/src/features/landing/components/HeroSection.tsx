import ArrowIcon from '../../../components/ui/ArrowIcon'
import DashboardPreview from './DashboardPreview'

function HeroSection() {
  return (
    <section
      className="relative mx-auto grid w-[min(100%-40px,1328px)] grid-cols-1 items-center gap-8 py-10 pb-[68px] md:w-[min(100%-112px,1328px)] md:grid-cols-[0.83fr_1.17fr] md:gap-6 md:py-12 md:pb-[74px] lg:min-h-[637px] lg:gap-6"
      id="about"
    >
      <div className="relative z-10 px-0.5 py-2 md:py-3">
        <div className="flex items-center gap-2.5 text-[10px] font-bold tracking-[1.4px] text-[#737b73]">
          <span className="h-px w-[22px] bg-orange" />
          WAREHOUSE OPERATIONS, IN SYNC
        </div>
        <h1 className="mt-5 mb-3.5 font-display text-[clamp(46px,8vw,64px)] leading-[1.1] font-semibold tracking-[-2.8px] text-ink md:mt-6 md:text-[clamp(42px,4.65vw,64px)] md:tracking-[-3.1px]">
          Your warehouse.
          <br />
          <span className="text-green">Moving as one.</span>
        </h1>
        <p className="max-w-[430px] text-[15px] leading-[1.8] text-muted md:text-base">
          A clearer view of every item, every location, every move. Bring
          inventory and warehouse workflows together in one thoughtful system.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4 md:mt-7 md:gap-6">
          <a
            className="inline-flex min-h-12 items-center justify-center gap-3.5 rounded bg-green px-5 text-sm font-semibold text-white no-underline transition hover:-translate-y-0.5 hover:bg-green-dark"
            href="#platform"
          >
            Discover the platform
            <ArrowIcon />
          </a>
          <a
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#424c45] no-underline"
            href="#workflow"
          >
            See how it works <span className="text-[15px] text-orange">↓</span>
          </a>
        </div>
        <div className="mt-[22px] flex items-center gap-2 text-xs text-muted md:mt-[51px]">
          <svg className="size-[19px] text-green" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 2.5 16 5v4.2c0 3.7-2.5 6.5-6 8.3-3.5-1.8-6-4.6-6-8.3V5l6-2.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="m7.4 9.7 1.7 1.7 3.6-3.7"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
          </svg>
          Built around a reliable, traceable inventory ledger
        </div>
      </div>

      <DashboardPreview />

      <a
        className="absolute bottom-[21px] left-px flex items-center gap-2 text-[8px] font-semibold tracking-[1px] text-[#8a8f89] no-underline md:bottom-[29px]"
        href="#platform"
      >
        <span className="h-[25px] w-[17px] rounded-full border border-[#c9cdc6]" />
        SCROLL TO EXPLORE
      </a>
    </section>
  )
}

export default HeroSection

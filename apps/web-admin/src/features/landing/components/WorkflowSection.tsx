import ArrowIcon from '../../../components/ui/ArrowIcon'
import { workflowSteps } from '../data/previewData'

function WorkflowSection() {
  return (
    <section
      className="mx-auto w-[min(100%-40px,1328px)] border-t border-line pt-10 md:w-[min(100%-112px,1328px)] md:pt-[54px]"
      id="platform"
    >
      <div className="mb-6 flex flex-col gap-3.5 md:mb-[34px] md:flex-row md:items-end md:justify-between md:gap-10">
        <div>
          <div className="flex items-center gap-2.5 text-[10px] font-bold tracking-[1.4px] text-[#737b73]">
            <span className="h-px w-[22px] bg-orange" />
            ONE CONNECTED WORKFLOW
          </div>
          <h2 className="mt-4 font-display text-[34px] leading-[1.17] font-semibold tracking-[-1.7px] text-ink md:text-[38px]">
            From receiving dock
            <br />
            to ready to ship.
          </h2>
        </div>
        <p className="mb-1 max-w-[400px] text-sm leading-[1.8] text-muted md:mr-1 md:text-[15px]">
          Make the everyday work of moving goods feel less scattered. Keep each
          step connected to the inventory it changes.
        </p>
      </div>

      <div
        className="grid grid-cols-1 overflow-hidden rounded-md border border-[#e8e7e0] bg-white sm:grid-cols-3"
        id="workflow"
      >
        {workflowSteps.map((step) => (
          <article
            className="min-h-0 p-[17px_18px] sm:min-h-[236px] sm:p-[19px_22px_20px] [&+article]:border-t [&+article]:border-[#ecebe5] sm:[&+article]:border-t-0 sm:[&+article]:border-l"
            key={step.number}
          >
            <span className="text-[10px] font-semibold tracking-[1px] text-[#898e86]">
              {step.number} / {step.label}
            </span>
            <span
              className={`mt-3 mb-2.5 grid size-[29px] place-items-center rounded text-[17px] ${
                step.tone === 'green'
                  ? 'bg-[#edf3ed] text-[#477052]'
                  : step.tone === 'orange'
                    ? 'bg-[#f7f0e9] text-[#b47c50]'
                    : 'bg-[#edf3f4] text-[#648b97]'
              } sm:mt-[21px] sm:mb-[13px]`}
              aria-hidden="true"
            >
              {step.icon}
            </span>
            <h3 className="mb-2 font-display text-lg font-bold tracking-[-0.35px] text-[#27312a]">
              {step.title}
            </h3>
            <p className="max-w-[340px] text-[13px] leading-[1.75] text-[#777d76] md:text-sm">
              {step.description}
            </p>
            <a
              className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-green no-underline hover:text-green-dark"
              href={step.href}
            >
              {step.link}
              <ArrowIcon className="size-[13px]" />
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}

export default WorkflowSection

import ArrowIcon from '../../../components/ui/ArrowIcon'
import {
  inventoryMetrics,
  recentMovements,
  warehouseLocations,
} from '../data/previewData'

function DashboardPreview() {
  return (
    <div
      className="relative z-0 min-w-0 px-0 py-3 sm:px-1.5"
      role="region"
      aria-label="Illustrative warehouse dashboard preview"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden lg:block">
        <div className="absolute -right-22.5 -top-7 size-144 rounded-full border border-[#eeece6]" />
        <div className="absolute -right-30.5 -top-14.5 size-160 rounded-full border border-[#eeece6]" />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e7e7e1] bg-white text-[#222923] shadow-[0_28px_75px_-40px_rgb(37_48_38/24%),0_4px_14px_rgb(37_48_38/5%)]">
        <div className="flex h-11 items-center gap-2.5 border-b border-[#f0f0ec] px-3.5 sm:px-4.25">
          <div className="flex items-center gap-1.5 font-display text-sm font-extrabold tracking-[-0.5px] text-green">
            <span className="grid size-5 place-items-center rounded-md bg-green text-xs text-white">⌂</span>
            cargo
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-sm bg-[#f8f6f0] px-2 py-1.5 text-[9px] font-bold tracking-[0.65px] text-[#77776e]">
            <span className="size-1.25 rounded-full bg-[#c79458]" />
            SAMPLE WORKSPACE
          </span>
          <span className="grid size-7 place-items-center rounded-full bg-[#f3e4d5] text-[10px] font-bold text-[#76573f]">
            JD
          </span>
        </div>

        <div className="p-2.5 sm:p-5">
          <div className="mb-3.5 flex items-end justify-between gap-2">
            <div>
              <p className="mb-1.5 text-[9px] font-bold tracking-[0.95px] text-[#9a9d97]">
                OPERATIONS OVERVIEW
              </p>
              <h2 className="font-display text-base font-bold tracking-[-0.4px] text-[#262c27] sm:text-lg">
                Good morning, Jordan <span className="text-[#e4a163]">✳</span>
              </h2>
              <p className="mt-1 text-[10px] text-[#929790] sm:text-xs">
                Here’s what’s happening across your warehouse.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-[#ebebe5] px-2 py-1.5 text-[10px]">
              This week <span aria-hidden="true">⌄</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            {inventoryMetrics.map((metric) => (
              <article
                className="relative flex min-h-24 flex-col overflow-hidden rounded-md border border-[#edede8] px-2 py-2.5 sm:min-h-28 sm:px-3 sm:py-3.5"
                key={metric.label}
              >
                <span className="text-[9px] font-medium text-[#777e77] sm:text-[11px]">
                  {metric.label}
                </span>
                <span className="mt-2 font-display text-xl font-extrabold leading-none tracking-[-1px] text-[#27312a] sm:text-2xl">
                  {metric.value}{' '}
                  {metric.unit && (
                    <span className="font-sans text-[9px] font-medium tracking-normal text-[#8a9089] sm:text-[11px]">
                      {metric.unit}
                    </span>
                  )}
                </span>
                <span className="mt-auto flex items-center gap-1 text-[8px] text-[#8b918a] sm:text-[9px]">
                  <span
                    className={`size-1.25 rounded-full ${
                      metric.tone === 'green'
                        ? 'bg-[#6aa27b]'
                        : metric.tone === 'blue'
                          ? 'bg-[#72a6b7]'
                          : 'bg-[#e6a16c]'
                    }`}
                  />
                  {metric.note}
                </span>
                <span className="absolute right-2 top-1.5 text-base opacity-20">
                  {metric.icon}
                </span>
              </article>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 min-[480px]:grid-cols-[1.13fr_0.87fr]">
            <article className="min-w-0 rounded-md border border-[#edede8] p-2.5 sm:p-3">
              <div className="mb-2.5 flex items-start justify-between">
                <div>
                  <h3 className="font-display text-xs font-bold text-[#323832]">
                    Recent movements
                  </h3>
                  <p className="mt-0.5 text-[9px] text-[#9b9e98]">
                    A snapshot of activity
                  </p>
                </div>
                <a
                  className="grid size-5.5 place-items-center rounded-sm border border-[#ededeb] text-[#70776f] hover:text-green"
                  href="#workflow"
                  aria-label="View warehouse workflow"
                >
                  <ArrowIcon diagonal className="size-3" />
                </a>
              </div>
              {recentMovements.map((movement) => (
                <div
                  className="flex min-h-8.75 items-center gap-1.5 border-t border-[#f1f1ee]"
                  key={movement.title}
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded text-[11px] ${
                      movement.direction === 'in'
                        ? 'bg-[#edf5ef] text-[#558265]'
                        : movement.direction === 'out'
                          ? 'bg-[#fbf0e9] text-[#cb805a]'
                          : 'bg-[#edf3f4] text-[#688d9b]'
                    }`}
                  >
                    {movement.icon}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className="truncate text-[9px] font-semibold text-[#454b45] sm:text-[11px]">
                      {movement.title}
                    </strong>
                    <span className="truncate text-[8px] text-[#a0a39e] sm:text-[9px]">
                      {movement.location}
                    </span>
                  </span>
                  <span
                    className={`text-[9px] font-bold sm:text-[11px] ${
                      movement.direction === 'out'
                        ? 'text-[#ca7954]'
                        : 'text-[#508260]'
                    }`}
                  >
                    {movement.quantity}
                  </span>
                  <span className="min-w-6.75 text-right text-[8px] text-[#9a9f99] sm:text-[9px]">
                    {movement.time}
                  </span>
                </div>
              ))}
            </article>

            <article className="grid min-w-0 grid-cols-[1fr_1.15fr] items-center gap-x-2.5 gap-y-1 rounded-md border border-[#edede8] p-2.5 sm:block sm:p-3">
              <div className="mb-0 flex flex-col gap-1 sm:mb-2.5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-display text-xs font-bold text-[#323832]">
                    Warehouse floor
                  </h3>
                  <p className="mt-0.5 text-[9px] text-[#9b9e98]">
                    Storage at a glance
                  </p>
                </div>
                <span className="w-fit rounded-sm bg-[#f6f4ee] px-1.5 py-1 text-[8px] font-bold tracking-[0.5px] text-[#87877c]">
                  6 LOCATIONS
                </span>
              </div>
              <div
                className="grid grid-cols-3 gap-1 max-sm:col-start-2 max-sm:row-start-1"
                aria-label="Six warehouse locations shown with different occupancy levels"
              >
                {warehouseLocations.map((location) => (
                  <div
                    className={`flex min-h-8 flex-col items-center justify-center gap-px rounded border text-[9px] sm:min-h-10 ${
                      location.level === 'high'
                        ? 'border-[#f0e0d1] bg-[#f9eee5] text-[#a57253]'
                        : location.level === 'medium'
                          ? 'border-[#eee9d9] bg-[#f6f3e9] text-[#81784e]'
                          : location.level === 'empty'
                            ? 'border-[#ecece7] bg-[#f5f5f1] text-[#797d76]'
                            : 'border-[#e9ede6] bg-[#eff5ed] text-[#596b59]'
                    }`}
                    key={location.name}
                  >
                    <span>{location.name}</span>
                    <strong className="text-[10px] font-bold">
                      {location.occupancy}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="mt-0 flex gap-2.5 max-sm:col-start-2 max-sm:row-start-2 sm:mt-2.5">
                <span className="flex items-center gap-1 text-[8px] text-[#898e87]">
                  <span className="size-1.25 rounded-full bg-[#81a27e]" />
                  Available
                </span>
                <span className="flex items-center gap-1 text-[8px] text-[#898e87]">
                  <span className="size-1.25 rounded-full bg-[#dda170]" />
                  Near capacity
                </span>
              </div>
            </article>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-2 left-0 z-10 inline-flex min-h-10 items-center gap-2 rounded-md border border-[#ecebe4] bg-white px-3 text-[10px] font-medium text-[#505951] shadow-[0_8px_22px_rgb(43_51_43/9%)] sm:-left-6 sm:bottom-9 sm:min-h-11 sm:px-3.5 sm:text-xs">
        <span className="grid size-5 place-items-center rounded bg-[#f9f0e8] text-xs text-[#c77845]">
          ↗
        </span>
        Inventory, in motion
      </div>

      <div className="absolute -top-1 right-0 z-10 hidden min-h-11 items-center gap-2 rounded-md border border-[#ecebe4] bg-white px-3.5 text-xs font-medium text-[#505951] shadow-[0_8px_22px_rgb(43_51_43/9%)] sm:flex sm:-right-3 sm:top-10">
        <span className="grid size-5 place-items-center rounded bg-[#eff5ef] text-xs text-green">
          ✓
        </span>
        Every movement, accounted for
      </div>
    </div>
  )
}

export default DashboardPreview

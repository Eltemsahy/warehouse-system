type ArrowIconProps = {
  diagonal?: boolean
  className?: string
}

function ArrowIcon({ diagonal = false, className = 'h-4 w-4' }: ArrowIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
    >
      <path
        d={diagonal ? 'M5 15 15 5M6 5h9v9' : 'M3.5 10h12m-5-5 5 5-5 5'}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

export default ArrowIcon

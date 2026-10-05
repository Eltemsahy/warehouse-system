type BrandMarkProps = {
  className?: string
}

function BrandMark({ className = 'h-9 w-9' }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 36 36"
      fill="none"
    >
      <rect x="2" y="2" width="32" height="32" rx="10" fill="currentColor" />
      <path
        d="m10 14 8-4 8 4-8 4-8-4Zm0 0v8l8 4 8-4v-8m-8 4v8"
        stroke="#fffdf9"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export default BrandMark

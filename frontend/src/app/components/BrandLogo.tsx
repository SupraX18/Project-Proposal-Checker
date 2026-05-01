import type { SVGProps } from 'react';

export function ProjectLogoMark({
  size = 24,
  className,
  ...rest
}: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      {...rest}
    >
      {/* Outer hexagon ring */}
      <polygon
        points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="none"
        opacity="0.35"
      />
      {/* Inner hexagon */}
      <polygon
        points="24,10 36,17 36,31 24,38 12,31 12,17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.07"
      />
      {/* Vertical center line */}
      <line x1="24" y1="15" x2="24" y2="33" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* Horizontal bars */}
      <line x1="17" y1="20" x2="31" y2="20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="19" y1="24" x2="29" y2="24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="21" y1="28" x2="27" y2="28" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* Top dot — the "check" node */}
      <circle cx="24" cy="13" r="2.2" fill="currentColor" />
      {/* Corner accent dots */}
      <circle cx="36" cy="17" r="1.4" fill="currentColor" fillOpacity="0.6" />
      <circle cx="12" cy="31" r="1.4" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

export function BrandLogo({
  className = '',
  showText = true,
  compact = false,
}: {
  className?: string;
  showText?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`brand-logo ${compact ? 'compact' : ''} ${className}`.trim()}>
      <div className="brand-logo-mark-shell">
        <ProjectLogoMark size={compact ? 22 : 26} />
      </div>
      {showText ? (
        <div className="brand-logo-copy">
          <strong>ProposalCheck</strong>
          <span>Track · Review · Approve</span>
        </div>
      ) : null}
    </div>
  );
}

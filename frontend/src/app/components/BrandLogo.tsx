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
      {/* Document body */}
      <rect
        x="8" y="5" width="26" height="34"
        rx="4"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {/* Folded corner */}
      <path
        d="M26 5 L34 13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M26 5 L26 13 L34 13"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Text lines on document */}
      <line x1="13" y1="21" x2="25" y2="21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <line x1="13" y1="26" x2="22" y2="26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
      {/* Checkmark badge (bottom-right) */}
      <circle
        cx="34" cy="36" r="8"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <polyline
        points="30,36 33,39 38,32"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
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

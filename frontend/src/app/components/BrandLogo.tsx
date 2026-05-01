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
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...rest}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 7.5h6.2l2.3 2.3v5.9A2.3 2.3 0 0 1 14.2 18H8A2.5 2.5 0 0 1 5.5 15.5V10A2.5 2.5 0 0 1 8 7.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14.2 7.5v2.3h2.3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8.7 11h4.6M8.7 13.5h3.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="15.8" cy="15.8" r="3.1" fill="currentColor" fillOpacity="0.16" />
      <path
        d="m14.7 15.8.85.85 1.75-1.95"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
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
        <ProjectLogoMark size={compact ? 20 : 24} />
      </div>
      {showText ? (
        <div className="brand-logo-copy">
          <strong>Project Proposal Checker</strong>
          <span>Track proposals, documents, folders, and reviews</span>
        </div>
      ) : null}
    </div>
  );
}

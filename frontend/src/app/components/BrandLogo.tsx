import React from 'react';
import { cn } from './UI';

export function ProjectLogoMark({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={cn('h-5 w-5 text-current transition-transform duration-200 ease-out group-hover:scale-[1.02]', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 3.75h5.8L18.25 8v7.75A3.25 3.25 0 0 1 15 19H8a3.25 3.25 0 0 1-3.25-3.25V7A3.25 3.25 0 0 1 8 3.75Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 3.75V8h4.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.75 10h5.5M8.75 13h3.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="15.9" cy="15.9" r="3.1" fill="currentColor" fillOpacity="0.18" />
      <path
        d="m14.7 15.9.85.85 1.75-1.95"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandLogo({
  className,
  markClassName,
  textClassName,
  showText = true,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  showText?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3 select-none', className)}>
      <div
        className={cn(
          'h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-500 to-cyan-400 text-white shadow-lg shadow-indigo-200/60 grid place-items-center transition-transform duration-200 ease-out group-hover:scale-[1.02]',
          markClassName
        )}
      >
        <ProjectLogoMark />
      </div>
      {showText && (
        <div className={cn('leading-tight', textClassName)}>
          <div className="font-extrabold tracking-tight text-slate-900">Project Proposal Checker</div>
          <div className="text-xs text-slate-500">Submission • Review • Evaluation</div>
        </div>
      )}
    </div>
  );
}

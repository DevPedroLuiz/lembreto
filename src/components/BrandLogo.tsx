import React from 'react';
import { cn } from '../lib/cn';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

export function BrandMark({ className, title = 'Lembreto' }: BrandMarkProps) {
  const reactId = React.useId().replace(/[^A-Za-z0-9_-]/g, '');
  const titleId = `brand-${reactId}-title`;
  const gradientId = `brand-${reactId}-gradient`;
  const glowId = `brand-${reactId}-glow`;

  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-labelledby={titleId}
      className={cn('block shrink-0 overflow-visible', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="28" y1="102" x2="99" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0EA5FF" />
          <stop offset="0.52" stopColor="#00D8F5" />
          <stop offset="1" stopColor="#19F5D0" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="9" stdDeviation="8" floodColor="#0EA5FF" floodOpacity="0.24" />
        </filter>
      </defs>

      <g
        stroke={`url(#${gradientId})`}
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
      >
        <path d="M46 24H42C27.6 24 18 35.2 18 50.4V79.6C18 95.2 30.8 106 47.2 106H80.8C97.2 106 110 95.2 110 79.6V76" />
        <path d="M73 24H86C100.4 24 110 35.2 110 50.4V57" />
        <path d="M62 47V70C62 78 67 83 75 83H88" />
      </g>
    </svg>
  );
}

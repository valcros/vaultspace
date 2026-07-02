'use client';

import * as React from 'react';

/**
 * Decorative vault-tumbler mark for room cards: a thin ring of tick marks,
 * quiet and neutral. Purely ornamental (aria-hidden, no state encoding);
 * freshness and status stay in text where they belong.
 */
export function VaultRing({ size = 22 }: { size?: number }) {
  const ticks = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);
  const center = size / 2;
  const outer = size / 2 - 1;
  const inner = outer - 3.5;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0 text-neutral-300 transition-transform duration-300 group-hover:rotate-[30deg] dark:text-neutral-600"
    >
      <circle
        cx={center}
        cy={center}
        r={outer - 2}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      {ticks.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = center + inner * Math.cos(rad);
        const y1 = center + inner * Math.sin(rad);
        const x2 = center + outer * Math.cos(rad);
        const y2 = center + outer * Math.sin(rad);
        return (
          <line
            key={angle}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

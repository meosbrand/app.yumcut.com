import React from 'react';
import type { IconKey } from '@/shared/stick-scenes/schema';

/// Hand-built line-art icons on a fixed 0-100 viewBox. Deliberately not
/// emoji/text glyphs: those depend on whatever color-emoji font happens to
/// be installed on the render host, while stroke paths render identically
/// everywhere and match the whiteboard-diagram look.
const ICON_PATHS: Record<IconKey, React.ReactNode> = {
  lightbulb: (
    <>
      <circle cx="50" cy="38" r="26" />
      <path d="M38 62 L38 74 Q38 80 44 80 L56 80 Q62 80 62 74 L62 62" />
      <line x1="42" y1="88" x2="58" y2="88" />
    </>
  ),
  'chat-bubble': (
    <>
      <rect x="12" y="16" width="76" height="52" rx="10" />
      <path d="M34 68 L34 86 L54 68" />
    </>
  ),
  checkmark: <path d="M18 52 L40 76 L84 22" />,
  cross: (
    <>
      <line x1="20" y1="20" x2="80" y2="80" />
      <line x1="80" y1="20" x2="20" y2="80" />
    </>
  ),
  'question-mark': (
    <>
      <path d="M28 36 Q28 14 50 14 Q72 14 72 34 Q72 48 56 54 Q50 57 50 68" />
      <circle cx="50" cy="86" r="5" fill="currentColor" stroke="none" />
    </>
  ),
  gear: (
    <>
      <circle cx="50" cy="50" r="18" />
      <circle cx="50" cy="50" r="6" />
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * Math.PI) / 4;
        const x1 = 50 + Math.cos(angle) * 24;
        const y1 = 50 + Math.sin(angle) * 24;
        const x2 = 50 + Math.cos(angle) * 38;
        const y2 = 50 + Math.sin(angle) * 38;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </>
  ),
  'arrow-right': (
    <>
      <line x1="12" y1="50" x2="80" y2="50" />
      <path d="M58 28 L80 50 L58 72" />
    </>
  ),
  star: (
    <path d="M50 10 L61 38 L91 38 L67 57 L76 87 L50 69 L24 87 L33 57 L9 38 L39 38 Z" />
  ),
};

export function StickIcon({ iconKey, size = 48, color = '#1a1a1a' }: { iconKey: IconKey; size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke={color}
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color }}
    >
      {ICON_PATHS[iconKey]}
    </svg>
  );
}

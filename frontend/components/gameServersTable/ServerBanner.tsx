import type { LucideIcon } from 'lucide-react';
import { Crosshair, Gamepad2, Mountain, Ship, Skull, Swords, Trees } from 'lucide-react';

type BannerTheme = { from: string; to: string; glow: string; Icon: LucideIcon };

// Known games get a tint that suggests their world; anything else is picked by hash so a
// given game always gets the same banner.
const KNOWN: Array<{ match: RegExp; theme: BannerTheme }> = [
  { match: /minecraft|rlcraft|forge|paper|fabric|curseforge/i, theme: { from: '#1f6f43', to: '#0f2e2a', glow: '#5fd38d', Icon: Trees } },
  { match: /valheim/i, theme: { from: '#1c5a73', to: '#10243a', glow: '#7fd4f0', Icon: Ship } },
  { match: /rust/i, theme: { from: '#8a3b1d', to: '#2b1410', glow: '#f59e6b', Icon: Skull } },
  { match: /counter|cs2|csgo/i, theme: { from: '#7a5a12', to: '#2a1f0b', glow: '#f4c95d', Icon: Crosshair } },
  { match: /zomboid/i, theme: { from: '#6b1f2a', to: '#240d14', glow: '#f2848f', Icon: Skull } },
  { match: /palworld|hytale/i, theme: { from: '#2a5bb8', to: '#141f4a', glow: '#8fb4ff', Icon: Mountain } },
  { match: /garry|gmod/i, theme: { from: '#1f4fa8', to: '#121d45', glow: '#7aa7ff', Icon: Swords } },
];

const FALLBACK: BannerTheme[] = [
  { from: '#4c40de', to: '#17144a', glow: '#a29bff', Icon: Gamepad2 },
  { from: '#7c3aed', to: '#1f1147', glow: '#c4a5ff', Icon: Gamepad2 },
  { from: '#2563eb', to: '#121a4a', glow: '#93b8ff', Icon: Gamepad2 },
  { from: '#0f766e', to: '#0d2530', glow: '#6ee7d8', Icon: Gamepad2 },
];

function bannerTheme(key: string): BannerTheme {
  const known = KNOWN.find(({ match }) => match.test(key));
  if (known) return known.theme;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[hash % FALLBACK.length];
}

/** Decorative header art for a server card: a tinted gradient with layered waves. */
export function ServerBanner({ gameKey, gameLabel }: { gameKey: string; gameLabel: string }) {
  const { from, to, glow, Icon } = bannerTheme(`${gameKey} ${gameLabel}`);

  return (
    <div
      aria-hidden="true"
      className="gp-server-banner relative -mx-4 -mt-4 mb-4 h-24 overflow-hidden rounded-t-lg"
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
    >
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at 18% 0%, ${glow}55 0%, transparent 55%)` }}
      />
      <svg className="absolute inset-x-0 bottom-0 h-16 w-full" viewBox="0 0 400 64" preserveAspectRatio="none">
        <path d="M0 38 C 70 10, 130 58, 210 30 S 340 8, 400 26 L 400 64 L 0 64 Z" fill={glow} fillOpacity="0.16" />
        <path d="M0 50 C 90 28, 160 64, 250 42 S 360 30, 400 44 L 400 64 L 0 64 Z" fill="#000000" fillOpacity="0.22" />
      </svg>
      <Icon className="absolute -bottom-3 right-3 h-20 w-20 rotate-[-8deg]" style={{ color: glow, opacity: 0.22 }} />
    </div>
  );
}

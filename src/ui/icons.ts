import type { UpgradeId } from '../game/upgrades';

/** 24×24 stroke icons for upgrades. */
export const ICONS: Record<UpgradeId, string> = {
  barrel: 'M7 20V6M12 20V3M17 20V6',
  spread: 'M12 21V8M12 21L5 7M12 21l7-14',
  amp: 'M13 2 5 13h6l-1 9 8-11h-6z',
  crit: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19',
  overclock: 'M12 7v5l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  pierce: 'M3 12h18M16 7l5 5-5 5M10 7a5 5 0 1 0 0 10',
  missile: 'M5 19c3-6 8-11 14-14M14 5h5v5M5 19l3-1-2-2z',
  orbital: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 12a9 4 0 1 0 18 0 9 4 0 1 0-18 0',
  chain: 'M4 3l6 6-3 3 6 6-2 3M14 3l4 4-2 2 4 4',
  nova: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  sub: 'M12 11.5v1M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13',
  beam: 'M9 22V2h6v20M12 2v20',
  echo: 'M4 14l5-5 5 5M10 19l5-5 5 5',
  wingman: 'M12 3l3 6H9zM5 12l2.5 5h-5zM19 12l2.5 5h-5z',
  hull: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z',
  repair: 'M12 5v14M5 12h14',
  phase: 'M9 12a5 5 0 1 0 10 0 5 5 0 1 0-10 0M5 12a5 5 0 1 0 10 0 5 5 0 1 0-10 0',
  phoenix: 'M12 21c-4-3-6-7-4-12 1 2 2 3 3 3 0-3 1-6 4-9 0 4 3 6 3 10 0 4-3 7-6 8z',
  graze: 'M3 17c4 0 6-10 10-10 3 0 4 3 2 5-2 2-6 0-4-3M17 19h4',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3M6 7h3M15 7h3',
  thruster: 'M12 2l4 8H8zM12 10v6M9 18l3 4 3-4',
  capacitor: 'M6 7h12v13H6zM9 3v4M15 3v4M12 10v7M9 13.5h6',
  dilation: 'M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10',
  rhythm: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
};

export function iconSvg(id: UpgradeId): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[id]}"/></svg>`;
}

export const SHIP_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 57,36 88,70 84,79 63,65 50,73 37,65 16,79 12,70 43,36" fill="rgba(0,0,0,.55)" stroke="currentColor" stroke-width="4" stroke-linejoin="miter"/><polygon points="50,30 54,46 50,52 46,46" fill="#fff" opacity=".9"/></svg>`;

export const PAUSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

export const LOGO_SVG = `<svg class="logo" viewBox="-8 -8 376 118" role="img" aria-label="PULSAR">
  <defs>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="var(--accent)"/>
      <stop offset="0.55" stop-color="#ffffff"/>
      <stop offset="1" stop-color="var(--accent-2)"/>
    </linearGradient>
  </defs>
  <g class="letters">
    <path d="M4 74V8h40v34H4"/>
    <path d="M64 8v66h40V8"/>
    <path d="M124 8v66h36"/>
    <path d="M222 8h-42v33h42v33h-42"/>
    <path d="M242 74V8h40v66M242 41h40"/>
    <path d="M302 74V8h40v34h-40M324 42l18 32"/>
  </g>
  <path class="wave-base" d="M0 96h360"/>
  <path class="wave" d="M0 96h138l8-12 10 26 10-34 10 30 8-10h176"/>
</svg>`;

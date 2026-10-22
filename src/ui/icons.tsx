// Original line icons (24x24). Stroke width and fills come from CSS so each
// theme can render them as ink drawings, engraved iron, phosphor glyphs, etc.
import type { JSX } from "react";

const P: Record<string, JSX.Element> = {
  resume: (
    <>
      <path d="M7 3h10M7 21h10" />
      <path d="M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9" />
      <path className="fill" d="M10 18.5c1-1 3-1 4 0l1.5 2.5h-7z" />
    </>
  ),
  map: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
      <path className="fill" d="M11.5 11l1 1.6 1.8.3-1.3 1.3.3 1.8-1.8-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3z" />
    </>
  ),
  quests: (
    <>
      <path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8" />
      <path d="M6 4a2 2 0 0 0-2 2v1h4V6a2 2 0 0 0-2-2zM8 7v11a2 2 0 1 1-4 0" />
      <path d="M11 9h5M11 12h5M11 15h3" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3.5 3-5.2 5.5-5.2s4.7 1.7 5.5 5.2" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M15.5 13.6c2.4-.3 4.3 1.2 5 4.4" />
    </>
  ),
  journal: (
    <>
      <path d="M4 20l3-1 11-11-2-2L5 17z" />
      <path d="M14 6l2 2M19.5 4.5c.8.8.8 2 0 2.8L18 8.8 15.2 6l1.5-1.5c.8-.8 2-.8 2.8 0z" />
      <path className="fill" d="M4 20l1-3 2 2z" />
    </>
  ),
  discoveries: (
    <>
      <path d="M12 3l7 6-7 12L5 9z" />
      <path d="M5 9h14M9.5 9L12 21l2.5-12M9.5 9L12 3l2.5 6" />
    </>
  ),
  character: (
    <>
      <path d="M12 3l7 3v5c0 5-3.2 8.3-7 10-3.8-1.7-7-5-7-10V6z" />
      <path d="M12 8v8M9 11h6" />
    </>
  ),
  travel: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path className="fill" d="M15.5 8.5l-2 5-5 2 2-5z" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </>
  ),
  delves: (
    <>
      <path d="M4 21V11a8 8 0 0 1 16 0v10" />
      <path d="M8 21v-8a4 4 0 0 1 8 0v8M2 21h20" />
      <path d="M11 6v2M13 6v2" />
    </>
  ),
  ledger: (
    <>
      <path d="M3 10h18v10H3zM3 10l2-5h14l2 5" />
      <path d="M10 13h4v3h-4zM12 10V5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  image: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  compact: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  ontop: (
    <>
      <path d="M8 3h8l-1 6 3 3H6l3-3z" />
      <path d="M12 12v9" />
    </>
  ),
  live: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  hint: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  pen: <path d="M3 21c3-1 6-4 9-7s6-7 8-9c-2 2-6 5-9 8s-6 6-8 8z" />,
  rect: <path d="M4 6h16v12H4z" />,
  text: <path d="M5 6h14M12 6v13M9 19h6" />,
  eraser: <path d="M4 16l9-9 6 6-6 6H8zM9 20h11" />,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
  door: (
    <>
      <path d="M6 21V4h12v17M3 21h18" />
      <circle cx="14.5" cy="12.5" r="1" />
    </>
  ),
  lock: (
    <>
      <path d="M6 11h12v9H6z" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H21M17 12v3M20 12v2" />
    </>
  ),
  skull: (
    <>
      <path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 2.5 5v3h9v-3c1.3-1 2.5-2.5 2.5-5a7 7 0 0 0-7-7z" />
      <circle cx="9.5" cy="11" r="1.5" />
      <circle cx="14.5" cy="11" r="1.5" />
      <path d="M10.5 18v3M13.5 18v3" />
    </>
  ),
  chest: (
    <>
      <path d="M3 10h18v10H3zM3 10a9 4 0 0 1 18 0" />
      <path d="M10.5 12h3v3h-3z" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
    </>
  ),
  sword: <path d="M14.5 3H21v6.5L9.5 21 3 21v-6.5zM6 14l4 4M14 7l3 3" />,
  house: <path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5" />,
  revisit: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />,
  dot: <circle cx="12" cy="12" r="4" />,
  quest: (
    <>
      <path d="M12 4v10" />
      <circle cx="12" cy="18.5" r="1.4" className="fill" />
    </>
  ),
  arch: <path d="M5 21V10a7 7 0 0 1 14 0v11M9 21v-7a3 3 0 0 1 6 0v7" />,
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1-4 3.8-6 7-6s6 2 7 6" />
    </>
  ),
  book: <path d="M4 5c3-1.5 5.5-1.5 8 0v15c-2.5-1.5-5-1.5-8 0zM20 5c-3-1.5-5.5-1.5-8 0v15c2.5-1.5 5-1.5 8 0z" />,
  flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9" />,
  calendar: (
    <>
      <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
    </>
  ),
  export: <path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" />,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  play: <path d="M7 4l13 8-13 8z" />,
  stop: <path d="M6 6h12v12H6z" />,
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, title, className }: { name: IconName | string; size?: number; title?: string; className?: string }) {
  const body = P[name] ?? P.dot;
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}

export const SECTION_ICON: Record<string, IconName> = {
  resume: "resume",
  map: "map",
  quests: "quests",
  people: "people",
  journal: "journal",
  discoveries: "discoveries",
  character: "character",
  travel: "travel",
  delves: "delves",
  ledger: "ledger",
  settings: "settings",
};

export const MARKER_ICON: Record<string, IconName> = {
  quest: "quest",
  dungeon: "arch",
  merchant: "coin",
  trainer: "sword",
  npc: "person",
  treasure: "chest",
  danger: "skull",
  home: "house",
  revisit: "revisit",
  custom: "dot",
};

// Original decorative ornaments, one family per theme. Purely presentational:
// hidden when decorative effects are turned off.
import { useApp } from "../state/store.ts";
import { useTheme } from "./theme.ts";

export function Divider({ className = "" }: { className?: string }) {
  const deco = useApp((s) => s.prefs.decorations);
  const t = useTheme();
  if (!deco) return <hr className={`plain-rule ${className}`} />;
  const common = { className: `divider ${className}`, viewBox: "0 0 400 16", preserveAspectRatio: "none" as const, "aria-hidden": true };
  switch (t.id) {
    case "morrowind":
      return (
        <svg {...common}>
          <path d="M0 8H168M232 8H400" className="o-line" />
          <path d="M176 8l8-6 8 6-8 6zM208 8l8-6 8 6-8 6z" className="o-line" />
          <path d="M193 8l7-5 7 5-7 5z" className="o-fill" />
          <circle cx="160" cy="8" r="1.8" className="o-fill" />
          <circle cx="240" cy="8" r="1.8" className="o-fill" />
          <path d="M150 5l-6 3 6 3M250 5l6 3-6 3" className="o-line" />
        </svg>
      );
    case "daggerfall":
      return (
        <svg {...common}>
          <path d="M0 6H185M215 6H400M0 10H185M215 10H400" className="o-line" />
          <path d="M200 1l3 5h5l-3 2 3 5h-5l-3 2-3-2h-5l3-5-3-2h5z" className="o-fill" />
        </svg>
      );
    case "oblivion":
      return (
        <svg {...common}>
          <path d="M0 8H150M250 8H400" className="o-line" />
          <path d="M150 8c10 0 12-6 20-6s8 6 2 6-6-4 0-4M250 8c-10 0-12-6-20-6s-8 6-2 6 6-4 0-4" className="o-line" />
          <path d="M150 8c10 0 12 6 20 6s8-6 2-6M250 8c-10 0-12 6-20 6s-8-6-2-6" className="o-line" />
          <circle cx="200" cy="8" r="4.5" className="o-line" />
          <circle cx="200" cy="8" r="1.8" className="o-fill" />
        </svg>
      );
    case "skyrim":
      return (
        <svg {...common}>
          <path d="M0 8H178M222 8H400" className="o-line" />
          <path d="M200 1l7 7-7 7-7-7zM186 8l-6-5M186 8l-6 5M214 8l6-5M214 8l6 5" className="o-line" />
          <path d="M200 5l3 3-3 3-3-3z" className="o-fill" />
        </svg>
      );
    case "falloutnv":
      return (
        <svg {...common}>
          <path d="M0 8H400" className="o-line o-dash" />
          <path d="M2 3v10M398 3v10" className="o-line" />
        </svg>
      );
    case "kotor":
      return (
        <svg {...common}>
          <path d="M0 8H170l8-6h44l8 6H400" className="o-line" />
          <path d="M186 6h28v4h-28z" className="o-fill" />
        </svg>
      );
    case "gothic":
      return (
        <svg {...common}>
          <path d="M0 8.5 C60 7 120 9.5 185 8M215 8C280 9.5 340 7 400 8.5" className="o-line" />
          <path d="M200 1v14M194 6h12" className="o-line o-thick" />
        </svg>
      );
    case "stalker":
      return (
        <svg {...common}>
          <path d="M0 8H400" className="o-line" />
          {Array.from({ length: 21 }, (_, i) => (
            <path key={i} d={`M${i * 20} ${i % 5 === 0 ? 3 : 5}V8`} className="o-line" />
          ))}
        </svg>
      );
    default:
      return <hr className={`plain-rule ${className}`} />;
  }
}

/** A compass rose for map corners, styled per theme. */
export function Compass({ size = 72 }: { size?: number }) {
  const t = useTheme();
  const deco = useApp((s) => s.prefs.decorations);
  if (!deco) {
    return (
      <svg className="compass" width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
        <path d="M0 -40L6 0L0 40L-6 0Z" className="c-fill" />
        <text y="-42" textAnchor="middle" className="c-text">N</text>
      </svg>
    );
  }
  if (t.id === "falloutnv" || t.id === "stalker" || t.id === "kotor") {
    return (
      <svg className="compass" width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
        <circle r="30" className="c-line" />
        <circle r="18" className="c-line c-dash" />
        <path d="M0 -44V-20M0 20V44M-44 0H-20M20 0H44" className="c-line" />
        <path d="M0 -30L5 -12H-5Z" className="c-fill" />
        <text y="-34" dy="-4" textAnchor="middle" className="c-text">N</text>
      </svg>
    );
  }
  return (
    <svg className="compass" width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="34" className="c-line" />
      <circle r="27" className="c-line c-thin" />
      <path d="M0 -44L5 -5L0 0L-5 -5Z" className="c-fill" />
      <path d="M0 44L5 5L0 0L-5 5Z" className="c-line" />
      <path d="M44 0L5 5L0 0L5 -5Z" className="c-line" />
      <path d="M-44 0L-5 5L0 0L-5 -5Z" className="c-line" />
      <path d="M22 -22L4 -2M-22 22L-4 2M22 22L4 2M-22 -22L-4 -2" className="c-line c-thin" />
      <text y="-46" textAnchor="middle" className="c-text">N</text>
    </svg>
  );
}

/** Corner flourishes for framed panels (CSS positions four copies). */
export function Corners() {
  const deco = useApp((s) => s.prefs.decorations);
  const t = useTheme();
  if (!deco || !["morrowind", "oblivion", "daggerfall", "gothic"].includes(t.id)) return null;
  const path =
    t.id === "morrowind"
      ? "M2 22V8l6-6h14M6 22V10l4-4h12M2 2h3v3H2z"
      : t.id === "oblivion"
        ? "M2 24V12C2 6 6 2 12 2h12M8 24v-6c0-6 4-10 10-10h6M12 12a2 2 0 1 0 0.1 0"
        : t.id === "gothic"
          ? "M3 3h7v7H3zM6 6h1v1H6z"
          : "M2 2h9M2 2v9M5 5h6M5 5v6";
  return (
    <>
      {["tl", "tr", "bl", "br"].map((pos) => (
        <svg key={pos} className={`corner corner-${pos}`} viewBox="0 0 26 26" aria-hidden="true">
          <path d={path} />
        </svg>
      ))}
    </>
  );
}

// Shared UI building blocks. Styling comes from the active theme's CSS.
import { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent, JSX } from "react";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { Divider, Corners } from "./ornaments.tsx";
import { parseMarkdown } from "../core/markdown.ts";
import type { Inline, Block } from "../core/markdown.ts";
import { dataImageUrl, openExternal } from "../platform/native.ts";

export function Page({ title, subtitle, actions, children, className = "" }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`page ${className}`}>
      <header className="page-head">
        <div className="page-title-block">
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      <Divider className="page-divider" />
      <div className="page-body">{children}</div>
    </section>
  );
}

export function Panel({ title, actions, children, className = "", framed = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; framed?: boolean }) {
  return (
    <div className={`panel ${framed ? "framed" : ""} ${className}`}>
      {framed ? <Corners /> : null}
      {title || actions ? (
        <div className="panel-head">
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="panel-body">{children}</div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  icon,
  kind = "normal",
  disabled,
  title,
  type = "button",
  small,
}: {
  children?: ReactNode;
  onClick?: () => void;
  icon?: IconName;
  kind?: "normal" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  small?: boolean;
}) {
  return (
    <button type={type} className={`btn btn-${kind} ${small ? "btn-small" : ""} ${children ? "" : "btn-icon"}`} onClick={onClick} disabled={disabled} title={title} aria-label={!children ? title : undefined}>
      {icon ? <Icon name={icon} size={small ? 15 : 17} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

/** Two-step confirmation without browser dialogs (they would block the game window's input). */
export function ConfirmBtn({ children, onConfirm, icon = "trash", confirmText = "Click again to confirm", small = true }: { children?: ReactNode; onConfirm: () => void; icon?: IconName; confirmText?: string; small?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn btn-danger ${small ? "btn-small" : ""} ${armed ? "armed" : ""} ${children || armed ? "" : "btn-icon"}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      title={armed ? confirmText : typeof children === "string" ? children : "Delete"}
    >
      <Icon name={icon} size={small ? 15 : 17} />
      {armed ? <span>{confirmText}</span> : children ? <span>{children}</span> : null}
    </button>
  );
}

export function Pill({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "live" | "game" | "ok" | "warn" | "bad" | "accent"; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Marks where a value came from. Live values are never shown without this. */
export function Source({ kind }: { kind: "live" | "manual" | "game" | "sync" | "fixture" }) {
  const map = {
    live: ["live", "LIVE", "Reported by the game bridge"],
    sync: ["live", "SYNCED", "Imported from the game by the bridge"],
    game: ["game", "GAME FILES", "Read from your installed game files"],
    manual: ["plain", "MANUAL", "Entered by you"],
    fixture: ["warn", "TEST DATA", "From the synthetic replay, not your game"],
  } as const;
  const [tone, label, title] = map[kind];
  return (
    <Pill tone={tone} title={title}>
      {label}
    </Pill>
  );
}

export function Empty({ icon = "journal", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} />
      <div className="empty-title">{title}</div>
      {children ? <div className="empty-body">{children}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? "on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Single-line field that saves on blur or Enter. Text is saved exactly as typed. */
export function Field({
  value,
  onSave,
  placeholder,
  className = "",
  label,
  autoFocus,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  const commit = () => {
    if (dirty.current) {
      dirty.current = false;
      if (v !== value) onSave(v);
    }
  };
  const input = (
    <input
      className={`field ${className}`}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => {
        dirty.current = true;
        setV(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          dirty.current = false;
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
  return label ? (
    <label className="field-row">
      <span className="field-label">{label}</span>
      {input}
    </label>
  ) : (
    input
  );
}

/** Multi-line text that autosaves (debounced and on blur). Never trims or rewrites. */
export function TextBlock({
  value,
  onSave,
  placeholder,
  className = "",
  rows = 4,
  hand,
  autoFocus,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  hand?: boolean;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(v);
  latest.current = v;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current) {
      dirty.current = false;
      saveRef.current(latest.current);
    }
  }, []);
  useEffect(() => () => flush(), [flush]);
  return (
    <textarea
      className={`textblock ${hand ? "hand" : ""} ${className}`}
      value={v}
      rows={rows}
      placeholder={placeholder}
      autoFocus={autoFocus}
      spellCheck
      onChange={(e) => {
        dirty.current = true;
        setV(e.target.value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 900);
      }}
      onBlur={flush}
    />
  );
}

/** One-line quick add: type, press Enter. */
export function QuickAdd({ placeholder, onAdd, icon = "plus", hint }: { placeholder: string; onAdd: (text: string) => void | Promise<void>; icon?: IconName; hint?: string }) {
  const [v, setV] = useState("");
  const submit = async () => {
    const t = v.trim();
    if (!t) return;
    setV("");
    await onAdd(t);
  };
  return (
    <div className="quickadd">
      <Icon name={icon} size={16} />
      <input
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") void submit();
        }}
      />
      {hint ? <span className="quickadd-hint">{hint}</span> : null}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, className = "", title }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; title?: string }) {
  return (
    <select className={`select ${className}`} value={value} title={title} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ on, onChange, label, title }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; title?: string }) {
  return (
    <label className={`toggle ${on ? "on" : ""}`} title={title}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" aria-hidden="true" />
      <span className="toggle-label">{label}</span>
    </label>
  );
}

// -------------------------------------------------------------- markdown

function renderInline(nodes: Inline[], key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case "text":
        return <span key={k}>{n.v}</span>;
      case "b":
        return <strong key={k}>{renderInline(n.c, k)}</strong>;
      case "i":
        return <em key={k}>{renderInline(n.c, k)}</em>;
      case "code":
        return <code key={k}>{n.v}</code>;
      case "link":
        return (
          <a
            key={k}
            href={n.href}
            onClick={(e) => {
              e.preventDefault();
              void openExternal(n.href).catch(() => {});
            }}
          >
            {renderInline(n.c, k)}
          </a>
        );
    }
    return null;
  });
}

export function Markdown({ text, onToggle, className = "" }: { text: string; onToggle?: (line: number) => void; className?: string }) {
  const blocks: Block[] = parseMarkdown(text);
  const out: JSX.Element[] = blocks.map((b, i) => {
    switch (b.t) {
      case "h":
        return b.level === 1 ? <h3 key={i}>{renderInline(b.content)}</h3> : b.level === 2 ? <h4 key={i}>{renderInline(b.content)}</h4> : <h5 key={i}>{renderInline(b.content)}</h5>;
      case "p":
        return <p key={i}>{renderInline(b.content)}</p>;
      case "quote":
        return <blockquote key={i}>{renderInline(b.content)}</blockquote>;
      case "pre":
        return <pre key={i}>{b.v}</pre>;
      case "hr":
        return <hr key={i} />;
      case "ul":
      case "ol": {
        const items = b.items.map((it, j) => (
          <li key={j} className={it.checked === null ? "" : it.checked ? "check done" : "check"}>
            {it.checked !== null ? (
              <input type="checkbox" checked={it.checked} disabled={!onToggle} onChange={() => onToggle?.(it.line)} aria-label="Toggle item" />
            ) : null}
            <span>{renderInline(it.content)}</span>
          </li>
        ));
        return b.t === "ul" ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
      }
    }
    return <span key={i} />;
  });
  return <div className={`md ${className}`}>{out}</div>;
}

/** Image stored in the data folder (attachments/, maps/). */
export function DataImage({ rel, alt, className = "", onClick }: { rel: string; alt: string; className?: string; onClick?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    dataImageUrl(rel)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [rel]);
  if (err) return <div className={`img-missing ${className}`}>Image not found</div>;
  return src ? <img className={className} src={src} alt={alt} onClick={onClick} draggable={false} /> : <div className={`img-loading ${className}`} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Btn icon="close" kind="ghost" title="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** List on the left, detail on the right, with a draggable divider (width remembered). */
export function ListDetail({ id, list, detail, showDetail }: { id: string; list: ReactNode; detail: ReactNode; showDetail: boolean }) {
  const key = `codex.split.${id}`;
  const [w, setW] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(key)) || 340;
    } catch {
      return 340;
    }
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setW(Math.max(220, Math.min(720, drag.current.w + e.clientX - drag.current.x)));
    };
    const up = () => {
      if (drag.current) {
        drag.current = null;
        try {
          localStorage.setItem(key, String(w));
        } catch {
          /* storage unavailable */
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [key, w]);
  return (
    <div className={`listdetail ${showDetail ? "has-detail" : ""}`} style={{ ["--list-w" as string]: `${w}px` }}>
      <div className="ld-list">{list}</div>
      <div className="ld-split" onPointerDown={(e) => (drag.current = { x: e.clientX, w })} role="separator" aria-orientation="vertical" title="Drag to resize" />
      <div className="ld-detail">{detail}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

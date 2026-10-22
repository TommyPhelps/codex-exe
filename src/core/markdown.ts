/**
 * A small, safe Markdown subset for notes: headings, paragraphs, bullet and
 * numbered lists, checklists, quotes, code, rules, **bold**, *italic*,
 * `code` and [links](https://...). It produces a plain AST that the UI renders
 * as React elements - no HTML strings, so nothing in a note can inject markup.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export interface ListItem {
  /** null = plain bullet, boolean = checklist item. */
  checked: boolean | null;
  content: Inline[];
  /** 0-based source line, used to toggle checkboxes. */
  line: number;
}

export type Block =
  | { t: "h"; level: 1 | 2 | 3; content: Inline[] }
  | { t: "p"; content: Inline[] }
  | { t: "ul"; items: ListItem[] }
  | { t: "ol"; items: ListItem[] }
  | { t: "quote"; content: Inline[] }
  | { t: "pre"; v: string }
  | { t: "hr" };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && "*_`[]\\".includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "b", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = src.indexOf(ch, i + 1);
      const prev = i === 0 ? " " : src[i - 1];
      if (end > i + 1 && src[i + 1] !== " " && (ch === "*" || /\W/.test(prev))) {
        flush();
        out.push({ t: "i", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = src.indexOf("](", i + 1);
      const end = close > 0 ? src.indexOf(")", close + 2) : -1;
      if (close > i && end > close) {
        const href = src.slice(close + 2, end).trim();
        if (SAFE_URL.test(href)) {
          flush();
          out.push({ t: "link", href, c: parseInline(src.slice(i + 1, close)) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const CHECK = /^\[( |x|X)\]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", content: parseInline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, content: parseInline(h[2]) });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: "hr" });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      i--;
      blocks.push({ t: "quote", content: parseInline(body.join("\n")) });
      continue;
    }
    const bm = BULLET.exec(line);
    const nm = bm ? null : NUMBERED.exec(line);
    if (bm || nm) {
      flushPara();
      const ordered = !!nm;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (!m) break;
        const c = CHECK.exec(m[1]);
        items.push(c ? { checked: c[1] !== " ", content: parseInline(c[2]), line: i } : { checked: null, content: parseInline(m[1]), line: i });
        i++;
      }
      i--;
      blocks.push(ordered ? { t: "ol", items } : { t: "ul", items });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Flips the checkbox on a given source line. Returns the text unchanged if that line has none. */
export function toggleCheckbox(src: string, line: number): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const l = lines[line];
  if (l === undefined) return src;
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](.*)$/.exec(l);
  if (!m) return src;
  lines[line] = `${m[1]}[${m[2] === " " ? "x" : " "}]${m[3]}`;
  return lines.join("\n");
}

export function checklistProgress(src: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const l of src.split("\n")) {
    const m = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.exec(l);
    if (m) {
      total++;
      if (m[1] !== " ") done++;
    }
  }
  return { done, total };
}

export function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

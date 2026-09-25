// Copied from PolicyPrism/design-harness/tools/feedback/prism-feedback.js (v1.1.0).
// That file is the source of truth: re-copy it here to update. Loaded in dev only (see src/main.jsx).
/*
 * Prism Feedback — design-harness review extension.
 *
 * Canonical source. Do not edit the copies inlined into prototype pages;
 * edit this file and re-run `node tools/feedback/install.mjs`.
 *
 * Comment mode: pick any element, leave a comment, copy every comment as
 * Markdown (selector, element, context, box, styles) to paste into Claude.
 * Draw mode:    sketch over the current view (pen, highlighter, arrow, box,
 *               text) and copy/download it as a PNG with a note baked in.
 *
 * URL flag `?feedback=off` disables the extension (use it for QA captures).
 * API: window.prismFeedback — toMarkdown(), comments(), copy(), exportDrawing().
 */
(() => {
  "use strict";

  if (window.prismFeedback) return;
  const params = new URLSearchParams(location.search);
  if (params.get("feedback") === "off") return;

  const VERSION = "1.1.0";
  const H2C_URL = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.4.5/dist/html2canvas-pro.min.js";
  const scriptEl = document.currentScript;
  const data = (scriptEl && scriptEl.dataset) || {};
  const META = {
    feature: data.feature || "",
    version: data.version || "",
    page: data.page || decodeURIComponent(location.pathname.split("/").pop() || "index.html"),
    source: data.source || "",
  };
  const PAGE_KEY = META.feature ? `${META.feature}/${META.version}/${META.page}` : location.pathname;
  const STORE_KEY = `prism-feedback:v1:${PAGE_KEY}`;
  const PREF_KEY = "prism-feedback:prefs";
  const Z = 2147483000;

  /* ---------- storage (never trusted to exist) ---------- */
  const store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* private mode or blocked storage: keep working in memory */
      }
    },
  };

  const state = {
    mode: "idle", // idle | comment | draw
    expanded: false,
    panelOpen: false,
    hidden: false,
    comments: store.read(STORE_KEY, []),
    prefs: Object.assign({ corner: "right" }, store.read(PREF_KEY, {})),
    hoverEl: null,
    pick: null, // { el, stack: [] } or { area: {x,y,w,h} } while composing
    drag: null, // { x, y, active } while dragging out an area
    filter: "open", // open | resolved | all — which comments the list shows
    editingId: null,
    strokes: [],
    tool: "pen",
    color: "#E5484D",
    background: "page",
    lastImage: null,
  };

  /* ---------- small utilities ---------- */
  const clean = (s, max = 80) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  };
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toHex = (rgb) => {
    const m = String(rgb).match(/rgba?\(([^)]+)\)/);
    if (!m) return rgb;
    const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (a === 0) return "transparent";
    const hex = "#" + [r, g, b].map((v) => pad(Math.round(v).toString(16)).toUpperCase()).join("");
    return a !== undefined && a < 1 ? `${hex} @ ${Math.round(a * 100)}%` : hex;
  };
  const cssEscape = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  const titleLine = () =>
    META.feature ? `${META.feature} ${META.version} — ${META.page}`.replace(/\s+—/, " —") : document.title || location.pathname;

  /* ---------- element description ---------- */
  function isUnique(sel, el) {
    try {
      const found = document.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch (e) {
      return false;
    }
  }

  function selectorFor(el) {
    if (el.id && isUnique("#" + cssEscape(el.id), el)) return "#" + cssEscape(el.id);
    for (const attr of ["data-testid", "data-component", "data-id", "data-key", "aria-label", "name"]) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `${el.tagName.toLowerCase()}[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (isUnique(sel, el)) return sel;
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node === document.body) {
        parts.unshift("body");
        break;
      }
      if (node !== el && node.id && isUnique("#" + cssEscape(node.id), node)) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList]
        .filter((c) => c.length < 40 && !/^(css-|is-|has-|js-)|^(active|selected|open|hover|focus|visible|hidden)$/.test(c))
        .slice(0, 2);
      if (classes.length) part += "." + classes.map(cssEscape).join(".");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((s) => s.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      if (isUnique(sel, el)) return sel;
      node = parent;
    }
    return parts.join(" > ");
  }

  function accessibleName(el) {
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const t = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent)
        .join(" ");
      if (clean(t)) return clean(t);
    }
    // Visible text beats tooltips, so a comment is labeled by what the designer saw.
    return clean(
      el.getAttribute("aria-label") ||
        el.getAttribute("alt") ||
        el.innerText ||
        el.getAttribute("placeholder") ||
        (el.value && typeof el.value === "string" ? el.value : "") ||
        el.getAttribute("title") ||
        el.textContent,
      70
    );
  }

  function contextOf(el) {
    const out = [];
    let n = el.parentElement;
    const landmark =
      "section,article,aside,nav,header,main,form,dialog,fieldset,table,li,tr,[role=dialog],[role=region],[role=tabpanel],[role=group],[role=listitem],[role=row]";
    const heading =
      ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > header h1, :scope > header h2, :scope > header h3, :scope > header h4, :scope > legend, :scope > caption, :scope > [role=heading]";
    while (n && n !== document.body) {
      if (n.matches(landmark)) {
        let label = n.getAttribute("aria-label");
        if (!label) {
          const h = n.querySelector(heading);
          label = h && h.textContent;
        }
        const t = clean(label, 50);
        if (t && !out.includes(t)) out.push(t);
      }
      n = n.parentElement;
    }
    const h1 = document.querySelector("h1");
    const top = h1 && clean(h1.textContent, 50);
    if (top && !out.includes(top)) out.push(top);
    return out.slice(0, 4).reverse();
  }

  function describe(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const classes = [...el.classList].slice(0, 4).join(" ");
    const name = accessibleName(el);
    const kind = role || tag;
    const shortClass = el.classList[0] ? "." + el.classList[0] : "";
    const label = `${kind}${role ? "" : shortClass}${name ? ` "${clean(name, 40)}"` : ""}`;
    const font = `${cs.fontSize}/${cs.fontWeight} ${clean(cs.fontFamily.split(",")[0].replace(/["']/g, ""), 30)}`;
    const styles = [font, `color ${toHex(cs.color)}`];
    const bg = toHex(cs.backgroundColor);
    if (bg !== "transparent") styles.push(`bg ${bg}`);
    if (cs.borderTopWidth !== "0px" && cs.borderTopStyle !== "none")
      styles.push(`border ${cs.borderTopWidth} ${toHex(cs.borderTopColor)}`);
    if (cs.borderRadius !== "0px") {
      // "rounded-full" and friends compute to an enormous number; say what it means.
      const pill = cs.borderRadius.split(" ").every((v) => parseFloat(v) >= 9999);
      styles.push(`radius ${pill ? "pill (fully rounded)" : cs.borderRadius}`);
    }
    return {
      selector: selectorFor(el),
      label,
      tag,
      role,
      classes,
      name,
      context: contextOf(el),
      rect: {
        x: Math.round(r.left + scrollX),
        y: Math.round(r.top + scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      viewport: { w: innerWidth, h: innerHeight },
      styles: styles.join(" · "),
      url: location.href,
      hash: location.hash,
    };
  }

  /* ---------- areas (drag-selected regions) ---------- */
  // Rects are stored in document coordinates; these convert for the viewport.
  const toViewport = (r) => ({ left: r.x - scrollX, top: r.y - scrollY, width: r.w, height: r.h });
  const inside = (a, b) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.left + b.width + 1 && a.bottom <= b.top + b.height + 1;

  function elementsInArea(vr) {
    const found = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (el === host || host.contains(el) || el.closest("prism-feedback")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !inside(r, vr)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      // Keep only the outermost elements: a card, not every span inside it.
      if (found.some((f) => f.contains(el))) continue;
      found.push(el);
    }
    return found;
  }

  function commonAncestor(els, vr) {
    if (!els.length) {
      const cx = vr.left + vr.width / 2;
      const cy = vr.top + vr.height / 2;
      const hit = document.elementsFromPoint(cx, cy).find((el) => el !== host && !el.closest("prism-feedback"));
      return pickable(hit) ? hit : document.body;
    }
    let a = els[0].parentElement || document.body;
    while (a && a !== document.body && !els.every((el) => a.contains(el))) a = a.parentElement;
    return a || document.body;
  }

  function describeArea(vr) {
    const els = elementsInArea(vr);
    const container = commonAncestor(els, vr);
    const box = describe(container);
    const items = els.slice(0, 12).map((el) => {
      const d = describe(el);
      return { label: d.label, selector: d.selector };
    });
    return Object.assign(box, {
      kind: "area",
      label: `Area ${Math.round(vr.width)}×${Math.round(vr.height)} · ${els.length} element${els.length === 1 ? "" : "s"}`,
      area: { x: Math.round(vr.left + scrollX), y: Math.round(vr.top + scrollY), w: Math.round(vr.width), h: Math.round(vr.height) },
      items,
      itemCount: els.length,
    });
  }

  function resolve(c) {
    if (c._el && c._el.isConnected) return c._el;
    try {
      c._el = document.querySelector(c.selector);
    } catch (e) {
      c._el = null;
    }
    return c._el;
  }

  /* ---------- markdown export ---------- */
  const openComments = () => state.comments.filter((c) => !c.resolved);
  const numberOf = (c) => state.comments.indexOf(c) + 1;

  // By default only open comments go to Claude: resolved ones are done.
  // Pass { includeResolved: true } for everything, or { only: [comment] } for one.
  function toMarkdown(opts = {}) {
    const chosen = opts.only || (opts.includeResolved ? state.comments : openComments());
    const lines = [];
    lines.push(`# Prototype feedback: ${titleLine()}`);
    if (META.source) lines.push(`- File: \`${META.source}\``);
    lines.push(`- Page URL: ${location.href}`);
    lines.push(`- Exported: ${stamp()} · ${chosen.length} comment${chosen.length === 1 ? "" : "s"}`);
    chosen.forEach((c) => {
      lines.push("", `## ${numberOf(c)}. ${c.label}${c.resolved ? " (resolved)" : ""}`);
      String(c.comment || "")
        .split("\n")
        .forEach((l) => lines.push(`> ${l}`));
      if (c.kind === "area") {
        lines.push(
          `- Area: ${c.area.w}×${c.area.h} at (${c.area.x}, ${c.area.y}) in a ${c.viewport.w}×${c.viewport.h} viewport${
            c.hash ? ` · state \`${c.hash}\`` : ""
          }`
        );
        lines.push(`- Container: \`${c.selector}\``);
        if (c.context && c.context.length) lines.push(`- Where: ${c.context.join(" › ")}`);
        if (c.items && c.items.length) {
          lines.push(`- Inside (${c.itemCount}${c.itemCount > c.items.length ? `, first ${c.items.length}` : ""}):`);
          c.items.forEach((it) => lines.push(`  - ${it.label} — \`${it.selector}\``));
        } else lines.push(`- Inside: part of the container (no whole element fits in the area)`);
        return;
      }
      lines.push(`- Selector: \`${c.selector}\``);
      const attrs = [c.classes && `class="${c.classes}"`, c.role && `role="${c.role}"`].filter(Boolean).join(" ");
      lines.push(`- Element: \`<${c.tag}${attrs ? " " + attrs : ""}>\`${c.name ? ` — text "${c.name}"` : ""}`);
      if (c.context && c.context.length) lines.push(`- Where: ${c.context.join(" › ")}`);
      lines.push(
        `- Box: ${c.rect.w}×${c.rect.h} at (${c.rect.x}, ${c.rect.y}) in a ${c.viewport.w}×${c.viewport.h} viewport${
          c.hash ? ` · state \`${c.hash}\`` : ""
        }`
      );
      lines.push(`- Styles: ${c.styles}`);
      if (!resolve(c)) lines.push(`- Note: element not found on the current page state`);
    });
    return lines.join("\n");
  }

  /* ---------- clipboard / download ---------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function download(name, href) {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const fileBase = () =>
    `feedback-${(META.feature || "prototype").replace(/[^\w-]+/g, "-")}${META.version ? "-" + META.version : ""}-${stamp().replace(
      /[: ]/g,
      ""
    )}`;

  /* ---------- UI shell (shadow DOM keeps prototype CSS out) ---------- */
  const host = document.createElement("prism-feedback");
  host.setAttribute("data-prism-feedback-ui", "");
  host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${Z};`;
  const root = host.attachShadow({ mode: "open" });

  const ICON = {
    comment:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/></svg>',
    draw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20c3-1 5-6 8-6s3 3 6 2 2-6 2-6"/></svg>',
    marker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16h16" stroke-width="6" opacity=".45"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5M10 5h9v9"/></svg>',
    box: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9.5" r="1.5"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M7 11l5-5 5 5"/></svg>',
  };

  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .ui {
    --ink: #2B2A35; --muted: #545465; --line: #DDDFE5; --line-subtle: #E6E9EB; --page: #F6F6F9;
    --brand: #586EE0; --brand-dark: #3754A1; --active-text: #5264CC; --wash: rgba(88,110,224,0.08);
    --wash-border: rgba(88,110,224,0.38); --danger: #C62828;
    font: 400 13px/1.4 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--ink); -webkit-font-smoothing: antialiased;
  }
  [hidden] { display: none !important; }
  button, input, textarea, select { font: inherit; color: inherit; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px;
    border-radius: 6px; border: 1px solid var(--line); background: #fff; color: var(--ink); cursor: pointer;
    font-size: 12px; white-space: nowrap; transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out;
  }
  .btn:hover { background: #EBEBF0; border-color: #3D4452; }
  .btn:focus-visible, .icon:focus-visible, .pin:focus-visible, .chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand), 0 0 0 3px #fff; }
  .btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
  .btn.primary:hover { background: var(--brand-dark); border-color: var(--brand-dark); }
  .btn.ghost { border-color: transparent; background: transparent; }
  .btn.ghost:hover { background: #EBEBF0; border-color: transparent; }
  .btn.danger { color: var(--danger); }
  .btn[disabled] { opacity: .58; cursor: not-allowed; }
  .icon {
    width: 32px; height: 32px; display: inline-grid; place-items: center; border-radius: 6px; border: 1px solid transparent;
    background: transparent; color: var(--muted); cursor: pointer; position: relative; transition: background 140ms ease-out, color 140ms ease-out;
  }
  .icon:hover { background: #EBEBF0; color: var(--ink); }
  .icon[aria-pressed="true"] { background: var(--wash); border-color: var(--wash-border); color: var(--active-text); }
  .count {
    position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 9999px;
    background: var(--brand); color: #fff; font: 600 10px/16px "IBM Plex Mono", ui-monospace, Menlo, monospace; text-align: center;
  }
  .count:empty { display: none; }

  /* dock */
  .dock {
    position: fixed; bottom: 16px; right: 16px; pointer-events: auto; display: flex; align-items: center; gap: 2px; padding: 4px;
    background: #fff; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 18px 45px rgba(20,24,33,0.10);
  }
  .dock.left { right: auto; left: 16px; }
  /* Step aside for the open comments panel so its footer stays reachable. */
  .dock.beside-panel { right: 396px; }
  .dock.left.beside-panel { right: auto; left: 396px; }
  .dock .brandmark {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px 0 8px; border: 0; border-radius: 6px;
    background: transparent; color: var(--ink); font-weight: 500; cursor: pointer;
  }
  .dock .brandmark:hover { background: #EBEBF0; }
  .dock .brandmark .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); }
  .dock .sep { width: 1px; height: 20px; background: var(--line-subtle); margin: 0 4px; }
  .dock .tools { display: contents; }
  .dock:not(.expanded) .tools { display: none; }
  .status {
    position: fixed; bottom: 64px; right: 16px; max-width: 320px; padding: 8px 12px; border-radius: 8px; background: var(--ink); color: #fff;
    font-size: 12px; pointer-events: none; opacity: 0; transform: translateY(4px); transition: opacity 140ms ease-out, transform 140ms ease-out;
  }
  .status.left { right: auto; left: 16px; }
  .status.show { opacity: 1; transform: none; }
  .hint {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 9999px;
    background: var(--ink); color: #fff; font-size: 12px; pointer-events: none; white-space: nowrap;
  }
  .hint kbd { font: 500 11px "IBM Plex Mono", ui-monospace, Menlo, monospace; padding: 0 4px; border-radius: 4px; background: rgba(255,255,255,.16); }

  /* picking */
  .highlight {
    position: fixed; pointer-events: none; border: 2px solid var(--brand); background: rgba(88,110,224,0.08); border-radius: 4px;
    display: none;
  }
  .highlight.locked { border-style: solid; background: rgba(88,110,224,0.12); }
  .tag {
    position: absolute; left: -2px; bottom: calc(100% + 4px); max-width: 360px; padding: 2px 6px; border-radius: 4px; background: var(--brand);
    color: #fff; font: 500 11px/16px "IBM Plex Mono", ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .highlight.below .tag { bottom: auto; top: calc(100% + 4px); }

  /* popover */
  .pop {
    position: fixed; width: 320px; pointer-events: auto; background: #fff; border: 1px solid var(--line); border-radius: 8px;
    box-shadow: 0 18px 45px rgba(20,24,33,0.10); padding: 12px; display: none;
  }
  .pop.open { display: block; }
  .pop .target { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .pop .target code {
    flex: 1; min-width: 0; font: 500 11px/16px "IBM Plex Mono", ui-monospace, Menlo, monospace; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pop textarea {
    width: 100%; min-height: 88px; resize: vertical; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff;
    font-size: 13px; line-height: 1.45;
  }
  .pop textarea:focus { outline: none; border-color: #3D4452; box-shadow: 0 0 0 2px var(--brand), 0 0 0 3px #fff; }
  .pop .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .pop .row .muted { color: var(--muted); font-size: 11px; }

  /* pins */
  .pins { position: fixed; inset: 0; pointer-events: none; }
  .pin {
    position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 9999px 9999px 9999px 2px; border: 2px solid #fff;
    background: var(--brand); color: #fff; font: 600 11px/18px "IBM Plex Mono", ui-monospace, Menlo, monospace; text-align: center;
    box-shadow: 0 2px 6px rgba(20,24,33,.25); cursor: pointer; pointer-events: auto; padding: 0;
  }
  .pin:hover { background: var(--brand-dark); }
  .ui.picking .pin { pointer-events: none; opacity: .6; }

  /* panel */
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 100vw; pointer-events: auto; background: #fff;
    border-left: 1px solid var(--line); display: none; flex-direction: column; box-shadow: 0 18px 45px rgba(20,24,33,0.10);
  }
  .panel.left { right: auto; left: 0; border-left: 0; border-right: 1px solid var(--line); }
  .panel.open { display: flex; }
  .panel header { display: flex; align-items: flex-start; gap: 8px; padding: 14px 14px 12px 16px; border-bottom: 1px solid var(--line-subtle); }
  .panel header h2 { margin: 0; font: 500 18px/1.2 "Newsreader", Georgia, serif; }
  .panel header p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
  .panel header > div { flex: 1; min-width: 0; }
  .panel .list { flex: 1; overflow: auto; padding: 8px 0; }
  .empty { padding: 32px 20px; color: var(--muted); text-align: center; font-size: 13px; }
  .item { padding: 10px 16px; border-bottom: 1px solid var(--line-subtle); }
  .item:hover { background: rgba(88,110,224,0.04); }
  .item .head { display: flex; align-items: center; gap: 8px; }
  .item .num {
    flex: none; width: 20px; height: 20px; border-radius: 9999px; background: var(--wash); border: 1px solid var(--wash-border);
    color: var(--active-text); font: 600 10px/18px "IBM Plex Mono", ui-monospace, Menlo, monospace; text-align: center;
  }
  .item .label { flex: 1; min-width: 0; font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item .where { margin: 2px 0 0 28px; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item .text { margin: 6px 0 0 28px; white-space: pre-wrap; font-size: 13px; }
  .item .missing { margin: 4px 0 0 28px; color: #7F4C06; font-size: 11px; }
  .item .actions { display: flex; gap: 2px; margin: 6px 0 0 22px; }
  .item .actions .btn { height: 24px; padding: 0 6px; }
  .item.resolved .label, .item.resolved .text, .item.resolved .where { color: var(--muted); }
  .item.resolved .text { text-decoration: line-through; text-decoration-color: rgba(84,84,101,.45); }
  .item.resolved .num { background: #E8F5EC; border-color: #9BCFAE; color: #1E6B3A; }
  .badge { flex: none; padding: 0 6px; border-radius: 9999px; background: #E8F5EC; color: #1E6B3A; font-size: 10px; font-weight: 600; line-height: 18px; }
  .item .area-items { margin: 4px 0 0 28px; color: var(--muted); font-size: 11px; }
  .filter { display: flex; gap: 4px; padding: 8px 16px 0; }
  .filter .btn { height: 24px; padding: 0 8px; font-size: 11px; }
  .filter .btn[aria-pressed="true"] { background: var(--wash); border-color: var(--wash-border); color: var(--active-text); }
  .highlight.area { border-style: dashed; border-radius: 2px; }
  .panel footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line-subtle); background: #FAFAFC; }
  .panel footer .grow { flex: 1; }

  /* draw */
  canvas.board { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: auto; cursor: crosshair; display: none; }
  .ui.drawing canvas.board { display: block; }
  .drawbar {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: none; align-items: center; gap: 2px; padding: 4px;
    pointer-events: auto; background: #fff; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 18px 45px rgba(20,24,33,0.10);
    max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center;
  }
  .ui.drawing .drawbar { display: flex; }
  .swatch { width: 20px; height: 20px; border-radius: 9999px; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--line); cursor: pointer; padding: 0; margin: 0 3px; }
  .swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--ink); }
  .drawbar input[type=text] {
    height: 28px; width: 180px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: #F5F5F7; font-size: 12px;
  }
  .drawbar select { height: 28px; border: 1px solid var(--line); border-radius: 6px; background: #fff; font-size: 12px; padding: 0 6px; }
  .drawbar input:focus, .drawbar select:focus { outline: none; box-shadow: 0 0 0 2px var(--brand), 0 0 0 3px #fff; }
  .textentry {
    position: fixed; min-width: 120px; padding: 2px 4px; border: 1px dashed currentColor; background: rgba(255,255,255,.9);
    font: 600 18px/1.3 "IBM Plex Sans", system-ui, sans-serif; pointer-events: auto; outline: none;
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  @media (max-width: 520px) {
    .panel { width: 100vw; bottom: 60px; border-bottom: 1px solid var(--line); }
    .dock.beside-panel, .dock.left.beside-panel { right: 16px; left: auto; }
    .dock.left.beside-panel { right: auto; left: 16px; }
    .drawbar input[type=text] { width: 140px; }
  }
</style>
<div class="ui">
  <div class="pins" part="pins"></div>
  <div class="highlight"><span class="tag"></span></div>
  <canvas class="board" aria-label="Drawing surface"></canvas>
  <div class="drawbar" role="toolbar" aria-label="Drawing tools">
    <button class="icon" data-tool="pen" aria-label="Pen" title="Pen (P)">${ICON.pen}</button>
    <button class="icon" data-tool="marker" aria-label="Highlighter" title="Highlighter (H)">${ICON.marker}</button>
    <button class="icon" data-tool="arrow" aria-label="Arrow" title="Arrow (A)">${ICON.arrow}</button>
    <button class="icon" data-tool="box" aria-label="Box" title="Box (B)">${ICON.box}</button>
    <button class="icon" data-tool="text" aria-label="Text" title="Text (T)">${ICON.text}</button>
    <span class="sep" style="width:1px;height:20px;background:#E6E9EB;margin:0 4px"></span>
    <button class="swatch" data-color="#E5484D" style="background:#E5484D" aria-label="Red"></button>
    <button class="swatch" data-color="#586EE0" style="background:#586EE0" aria-label="Periwinkle"></button>
    <button class="swatch" data-color="#FFB224" style="background:#FFB224" aria-label="Amber"></button>
    <button class="swatch" data-color="#2B2A35" style="background:#2B2A35" aria-label="Ink"></button>
    <span class="sep" style="width:1px;height:20px;background:#E6E9EB;margin:0 4px"></span>
    <button class="icon" data-act="undo" aria-label="Undo" title="Undo (⌘Z)">${ICON.undo}</button>
    <button class="icon" data-act="clear" aria-label="Clear drawing" title="Clear">${ICON.trash}</button>
    <span class="sep" style="width:1px;height:20px;background:#E6E9EB;margin:0 4px"></span>
    <input type="text" class="note" placeholder="Note for Claude (baked into the image)" aria-label="Note for Claude">
    <select class="bg" aria-label="Image background" title="Page: rendered from the DOM · Screen: exact pixels via a capture prompt · None: strokes on white">
      <option value="page">Page</option>
      <option value="screen">Screen</option>
      <option value="none">None</option>
    </select>
    <button class="btn primary" data-act="copy-image">${ICON.image}Copy image</button>
    <button class="icon" data-act="download-image" aria-label="Download PNG" title="Download PNG">${ICON.down}</button>
    <button class="icon" data-act="exit-draw" aria-label="Done drawing" title="Done (Esc)">${ICON.close}</button>
  </div>
  <div class="pop" role="dialog" aria-label="Comment">
    <div class="target">
      <code class="target-label"></code>
      <button class="icon" data-act="parent" aria-label="Select parent element" title="Select parent (↑)">${ICON.up}</button>
    </div>
    <textarea placeholder="What should change here?" aria-label="Comment"></textarea>
    <div class="row">
      <span class="muted">⌘/Ctrl + Enter to save</span>
      <span>
        <button class="btn ghost danger" data-act="delete" hidden>Delete</button>
        <button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="save">Save</button>
      </span>
    </div>
  </div>
  <aside class="panel" role="dialog" aria-label="Prototype feedback">
    <header>
      <div>
        <h2>Feedback</h2>
        <p class="panel-sub"></p>
      </div>
      <button class="icon" data-act="close-panel" aria-label="Close feedback list">${ICON.close}</button>
    </header>
    <div class="filter" role="group" aria-label="Which comments">
      <button class="btn" data-act="filter-open" aria-pressed="true">Open</button>
      <button class="btn" data-act="filter-resolved" aria-pressed="false">Resolved</button>
      <button class="btn" data-act="filter-all" aria-pressed="false">All</button>
    </div>
    <div class="list"></div>
    <footer>
      <button class="btn primary" data-act="copy-md">${ICON.copy}Copy for Claude</button>
      <button class="btn" data-act="download-md">${ICON.down}.md</button>
      <span class="grow"></span>
      <button class="btn ghost danger" data-act="clear-all">Clear all</button>
    </footer>
  </aside>
  <div class="hint" hidden></div>
  <div class="status" role="status" aria-live="polite"></div>
  <div class="dock" role="toolbar" aria-label="Prototype feedback">
    <button class="brandmark" data-act="toggle-dock" aria-expanded="false" title="Prism Feedback (⌥⇧F)">
      <span class="dot"></span>Feedback
    </button>
    <span class="tools">
      <span class="sep"></span>
      <button class="icon" data-act="mode-comment" aria-pressed="false" aria-label="Comment on an element" title="Comment on an element (⌥⇧C)">${ICON.comment}</button>
      <button class="icon" data-act="mode-draw" aria-pressed="false" aria-label="Draw on the page" title="Draw (⌥⇧D)">${ICON.draw}</button>
      <button class="icon" data-act="toggle-panel" aria-pressed="false" aria-label="Show comments" title="Comments">${ICON.list}<span class="count"></span></button>
      <button class="icon" data-act="copy-md" aria-label="Copy comments for Claude" title="Copy comments for Claude">${ICON.copy}</button>
      <span class="sep"></span>
      <button class="icon" data-act="swap-side" aria-label="Move toolbar to the other side" title="Move to other side">${ICON.swap}</button>
    </span>
  </div>
</div>`;

  const $ = (sel) => root.querySelector(sel);
  const ui = $(".ui");
  const dock = $(".dock");
  const panel = $(".panel");
  const pop = $(".pop");
  const popText = pop.querySelector("textarea");
  const highlight = $(".highlight");
  const tag = $(".tag");
  const pins = $(".pins");
  const hint = $(".hint");
  const statusEl = $(".status");
  const board = $("canvas.board");
  const ctx = board.getContext("2d");
  const noteInput = $(".note");
  const bgSelect = $(".bg");

  // Keep keystrokes typed into the feedback UI away from prototype shortcuts.
  ["keydown", "keyup", "keypress"].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));

  const fromUI = (e) => e.composedPath().includes(host);

  let statusTimer = 0;
  function say(msg, ms = 2600) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("show"), ms);
  }

  function setHint(html) {
    if (html) {
      hint.innerHTML = html;
      hint.hidden = false;
    } else hint.hidden = true;
  }

  function applyCorner() {
    const left = state.prefs.corner === "left";
    dock.classList.toggle("left", left);
    statusEl.classList.toggle("left", left);
    panel.classList.toggle("left", left);
  }

  function save() {
    store.write(
      STORE_KEY,
      state.comments.map(({ _el, ...rest }) => rest)
    );
    render();
  }

  /* ---------- modes ---------- */
  function setMode(mode) {
    if (state.mode === mode) mode = "idle";
    closePop();
    state.mode = mode;
    ui.classList.toggle("picking", mode === "comment");
    ui.classList.toggle("drawing", mode === "draw");
    $('[data-act="mode-comment"]').setAttribute("aria-pressed", String(mode === "comment"));
    $('[data-act="mode-draw"]').setAttribute("aria-pressed", String(mode === "draw"));
    hideHighlight();
    if (mode === "comment") {
      setHint("Click an element, or drag to select an area · <kbd>Esc</kbd> to stop");
      document.documentElement.style.setProperty("cursor", "crosshair", "important");
    } else {
      document.documentElement.style.removeProperty("cursor");
      setHint(null);
    }
    if (mode === "draw") {
      setDock(true);
      sizeBoard();
      selectTool(state.tool);
      selectColor(state.color);
    }
  }

  function setDock(expanded) {
    state.expanded = expanded;
    dock.classList.toggle("expanded", expanded);
    $('[data-act="toggle-dock"]').setAttribute("aria-expanded", String(expanded));
  }

  function setPanel(open) {
    state.panelOpen = open;
    panel.classList.toggle("open", open);
    dock.classList.toggle("beside-panel", open);
    $('[data-act="toggle-panel"]').setAttribute("aria-pressed", String(open));
    if (open) render();
  }

  /* ---------- picking ---------- */
  function pickable(el) {
    return el && el.nodeType === 1 && el !== host && el !== document.documentElement && el !== document.body;
  }

  function showBox(r, text, locked, isArea) {
    highlight.style.display = "block";
    highlight.style.left = r.left - 2 + "px";
    highlight.style.top = r.top - 2 + "px";
    highlight.style.width = r.width + 4 + "px";
    highlight.style.height = r.height + 4 + "px";
    highlight.classList.toggle("locked", !!locked);
    highlight.classList.toggle("area", !!isArea);
    highlight.classList.toggle("below", r.top < 28);
    tag.textContent = text;
  }

  function showHighlight(el, locked) {
    if (!el) return hideHighlight();
    const r = el.getBoundingClientRect();
    const d = el.tagName.toLowerCase() + (el.classList[0] ? "." + el.classList[0] : "");
    showBox(r, `${d}  ${Math.round(r.width)}×${Math.round(r.height)}`, locked, false);
  }

  function showArea(area, locked) {
    showBox(toViewport(area), `area  ${area.w}×${area.h}`, locked, true);
  }

  // Whatever is being commented on, as a viewport rect: an element or an area.
  const pickRect = (pick) => (pick.area ? toViewport(pick.area) : pick.el.getBoundingClientRect());
  const showPick = (pick) => (pick.area ? showArea(pick.area, true) : showHighlight(pick.el, true));

  function hideHighlight() {
    highlight.style.display = "none";
  }

  const swallow = (e) => {
    if (state.mode !== "comment" || fromUI(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const DRAG_START = 6; // px of movement before a press becomes an area drag
  let suppressClick = false;

  const dragRect = (d, e) => {
    const left = Math.min(d.x, e.clientX);
    const top = Math.min(d.y, e.clientY);
    return { left, top, width: Math.abs(e.clientX - d.x), height: Math.abs(e.clientY - d.y) };
  };

  document.addEventListener(
    "mousemove",
    (e) => {
      if (state.mode !== "comment" || state.pick || fromUI(e)) return;
      if (state.drag) {
        if (!state.drag.active && Math.hypot(e.clientX - state.drag.x, e.clientY - state.drag.y) > DRAG_START) state.drag.active = true;
        if (state.drag.active) {
          const r = dragRect(state.drag, e);
          return showBox(r, `area  ${Math.round(r.width)}×${Math.round(r.height)}`, false, true);
        }
      }
      const el = e.target;
      if (!pickable(el)) return hideHighlight();
      state.hoverEl = el;
      showHighlight(el, false);
    },
    true
  );

  // Press-and-drag draws an area; a plain click still picks one element.
  // Registered before `swallow` below: its stopImmediatePropagation would
  // otherwise keep these from ever running.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (state.mode !== "comment" || state.pick || fromUI(e) || e.button !== 0) return;
      state.drag = { x: e.clientX, y: e.clientY, active: false };
    },
    true
  );
  document.addEventListener(
    "mouseup",
    (e) => {
      const d = state.drag;
      state.drag = null;
      // A fast flick can press and release without a mousemove in between.
      const moved = d && (d.active || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_START);
      if (!moved || state.mode !== "comment") return;
      const r = dragRect(d, e);
      suppressClick = true; // the click that follows this mouseup is not a pick
      setTimeout(() => (suppressClick = false), 0);
      if (r.width < 12 || r.height < 12) return hideHighlight();
      openPop({ area: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) } }, null);
    },
    true
  );

  // Block the prototype's own handlers while picking. touchstart is left alone
  // so taps still synthesize the click that selects an element on touch screens.
  ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick"].forEach((t) =>
    document.addEventListener(t, swallow, { capture: true, passive: false })
  );

  document.addEventListener(
    "click",
    (e) => {
      if (state.mode !== "comment" || fromUI(e)) return;
      swallow(e);
      if (suppressClick) return;
      const el = e.target;
      if (!pickable(el)) return;
      openPop({ el }, null);
    },
    true
  );

  /* ---------- popover ---------- */
  function placePop(pick) {
    const r = pickRect(pick);
    const w = 320;
    const h = pop.offsetHeight || 190;
    let left = Math.min(Math.max(12, r.left), innerWidth - w - 12);
    let top = r.top + r.height + 10;
    if (top + h > innerHeight - 12) top = r.top - h - 10;
    if (top < 12) top = Math.min(innerHeight - h - 12, Math.max(12, r.top + 12));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  // `pick` is { el } for one element or { area } for a dragged region.
  function openPop(pick, comment) {
    state.pick = Object.assign({ stack: [] }, pick);
    state.editingId = comment ? comment.id : null;
    pop.classList.add("open");
    pop.querySelector('[data-act="delete"]').hidden = !comment;
    pop.querySelector('[data-act="parent"]').hidden = !!comment || !!pick.area;
    popText.value = comment ? comment.comment : "";
    updatePopTarget();
    // The first click after load also focuses the window, which can restore
    // focus to <body> after ours; retry once so typing lands in the comment.
    const focusText = () => pop.classList.contains("open") && root.activeElement !== popText && popText.focus();
    setTimeout(focusText, 0);
    setTimeout(focusText, 150);
  }

  function updatePopTarget() {
    const pick = state.pick;
    showPick(pick);
    const label = pop.querySelector(".target-label");
    if (pick.area) {
      const n = elementsInArea(toViewport(pick.area)).length;
      label.textContent = `Area ${pick.area.w}×${pick.area.h} · ${n} element${n === 1 ? "" : "s"}`;
      label.title = "Everything inside the dashed box";
    } else {
      const d = describe(pick.el);
      label.textContent = d.label;
      label.title = d.selector;
    }
    placePop(pick);
  }

  function closePop() {
    state.pick = null;
    state.editingId = null;
    // Drop focus from the hidden textarea so Esc and shortcuts reach the page again.
    if (pop.contains(root.activeElement)) root.activeElement.blur();
    pop.classList.remove("open");
    hideHighlight();
  }

  function commitPop() {
    const text = popText.value.trim();
    if (!state.pick) return;
    if (!text) {
      say("Write a comment first");
      popText.focus();
      return;
    }
    if (state.editingId) {
      const c = state.comments.find((x) => x.id === state.editingId);
      if (c) c.comment = text;
    } else if (state.pick.area) {
      const d = describeArea(toViewport(state.pick.area));
      state.comments.push(Object.assign({ id: uid(), comment: text, createdAt: new Date().toISOString() }, d));
    } else {
      const d = describe(state.pick.el);
      state.comments.push(Object.assign({ id: uid(), comment: text, createdAt: new Date().toISOString() }, d, { _el: state.pick.el }));
    }
    closePop();
    save();
    const open = openComments().length;
    say(`Saved · ${open} open comment${open === 1 ? "" : "s"}`);
  }

  pop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]") && e.target.closest("[data-act]").dataset.act;
    if (act === "save") commitPop();
    if (act === "cancel") closePop();
    if (act === "parent" && state.pick && state.pick.el) {
      const up = state.pick.el.parentElement;
      if (pickable(up)) {
        state.pick.stack.push(state.pick.el);
        state.pick.el = up;
        updatePopTarget();
      }
    }
    if (act === "delete" && state.editingId) {
      state.comments = state.comments.filter((c) => c.id !== state.editingId);
      closePop();
      save();
      say("Comment deleted");
    }
  });

  popText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitPop();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePop();
    } else if (e.key === "ArrowUp" && e.altKey && state.pick) {
      e.preventDefault();
      pop.querySelector('[data-act="parent"]').click();
    }
  });

  /* ---------- pins + list ---------- */
  const shown = () =>
    state.filter === "all" ? state.comments : state.comments.filter((c) => (state.filter === "resolved" ? c.resolved : !c.resolved));

  function render() {
    const total = state.comments.length;
    const open = openComments().length;
    const done = total - open;
    $(".count").textContent = open ? String(open) : "";
    $(".panel-sub").textContent = `${titleLine()} · ${open} open${done ? ` · ${done} resolved` : ""}`;
    root.querySelectorAll(".filter [data-act]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.act === "filter-" + state.filter)));
    root.querySelector('[data-act="filter-open"]').textContent = `Open${open ? ` (${open})` : ""}`;
    root.querySelector('[data-act="filter-resolved"]').textContent = `Resolved${done ? ` (${done})` : ""}`;

    const list = $(".list");
    const items = shown();
    if (!total) {
      list.innerHTML = `<div class="empty">No comments yet.<br>Turn on <b>Comment</b>, then click an element or drag across an area.</div>`;
    } else if (!items.length) {
      list.innerHTML = `<div class="empty">${state.filter === "resolved" ? "Nothing resolved yet." : "Everything here is resolved."}</div>`;
    } else {
      list.innerHTML = items
        .map((c) => {
          const n = numberOf(c);
          const missing = c.kind !== "area" && !resolve(c);
          return `
        <div class="item${c.resolved ? " resolved" : ""}" data-id="${c.id}">
          <div class="head"><span class="num">${n}</span><span class="label" title="${esc(c.selector)}">${esc(c.label)}</span>${
            c.resolved ? '<span class="badge">Resolved</span>' : ""
          }</div>
          ${c.context && c.context.length ? `<div class="where">${esc(c.context.join(" › "))}</div>` : ""}
          <div class="text">${esc(c.comment)}</div>
          ${
            c.kind === "area" && c.items && c.items.length
              ? `<div class="area-items">${esc(c.items.slice(0, 3).map((it) => it.label).join(" · "))}${c.itemCount > 3 ? ` · +${c.itemCount - 3} more` : ""}</div>`
              : ""
          }
          ${missing ? `<div class="missing">Not on screen in the current state${c.hash ? ` (was ${esc(c.hash)})` : ""}</div>` : ""}
          <div class="actions">
            <button class="btn ghost" data-act="${c.resolved ? "reopen" : "resolve"}">${c.resolved ? "Reopen" : "Resolve"}</button>
            <button class="btn ghost" data-act="copy-one" title="Copy just this comment for Claude">Copy</button>
            <button class="btn ghost" data-act="locate">Locate</button>
            <button class="btn ghost" data-act="edit">Edit</button>
            <button class="btn ghost danger" data-act="remove">Delete</button>
          </div>
        </div>`;
        })
        .join("");
    }
    positionPins(true);
  }

  // Resolved comments keep their place in the list but lose their pin.
  function positionPins(rebuild) {
    if (rebuild) {
      pins.innerHTML = openComments()
        .map((c) => `<button class="pin" data-id="${c.id}" aria-label="Comment ${numberOf(c)}: ${esc(clean(c.comment, 60))}">${numberOf(c)}</button>`)
        .join("");
    }
    if (state.hidden) return;
    pins.querySelectorAll(".pin").forEach((pin) => {
      const c = state.comments.find((x) => x.id === pin.dataset.id);
      if (!c) return (pin.style.display = "none");
      let r;
      if (c.kind === "area") r = toViewport(c.area);
      else {
        const el = resolve(c);
        if (!el) return (pin.style.display = "none");
        r = el.getBoundingClientRect();
      }
      const right = r.left + r.width;
      const bottom = r.top + r.height;
      const visible = r.width + r.height > 0 && bottom > 0 && r.top < innerHeight && right > 0 && r.left < innerWidth;
      pin.style.display = visible ? "block" : "none";
      pin.style.left = Math.min(Math.max(right, 14), innerWidth - 14) + "px";
      pin.style.top = Math.min(Math.max(r.top, 14), innerHeight - 14) + "px";
    });
  }

  let pinFrame = 0;
  const schedulePins = () => {
    if (pinFrame) return;
    pinFrame = requestAnimationFrame(() => {
      pinFrame = 0;
      positionPins(false);
      if (state.pick) placePop(state.pick), showPick(state.pick);
    });
  };
  addEventListener("scroll", schedulePins, { capture: true, passive: true });
  addEventListener("resize", () => {
    schedulePins();
    if (state.mode === "draw") sizeBoard();
  });
  setInterval(() => state.comments.length && schedulePins(), 600);

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The pick a comment was made on: its element, or its area.
  const pickOf = (c) => (c.kind === "area" ? { area: c.area } : resolve(c) ? { el: resolve(c) } : null);

  function locate(c) {
    const pick = pickOf(c);
    if (!pick) return say("That element is not on the page right now");
    if (pick.area) {
      scrollTo({
        left: Math.max(0, pick.area.x + pick.area.w / 2 - innerWidth / 2),
        top: Math.max(0, pick.area.y + pick.area.h / 2 - innerHeight / 2),
        behavior: reduced() ? "auto" : "smooth",
      });
    } else pick.el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
    setTimeout(() => {
      showPick(pick);
      setTimeout(() => !state.pick && hideHighlight(), 1400);
    }, 350);
  }

  pins.addEventListener("click", (e) => {
    const pin = e.target.closest(".pin");
    if (!pin) return;
    const c = state.comments.find((x) => x.id === pin.dataset.id);
    const pick = c && pickOf(c);
    if (pick) openPop(pick, c);
  });
  pins.addEventListener("mouseover", (e) => {
    const pin = e.target.closest(".pin");
    const c = pin && state.comments.find((x) => x.id === pin.dataset.id);
    const pick = c && pickOf(c);
    if (pick && !state.pick) showPick(pick);
  });
  pins.addEventListener("mouseout", () => !state.pick && state.mode !== "comment" && hideHighlight());

  $(".list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    const item = e.target.closest(".item");
    if (!btn || !item) return;
    const c = state.comments.find((x) => x.id === item.dataset.id);
    if (!c) return;
    const act = btn.dataset.act;
    if (act === "locate") locate(c);
    if (act === "edit") {
      const pick = pickOf(c);
      if (!pick) return say("That element is not on the page right now");
      locate(c);
      setTimeout(() => openPop(pick, c), 380);
    }
    if (act === "resolve" || act === "reopen") {
      c.resolved = act === "resolve";
      c.resolvedAt = c.resolved ? new Date().toISOString() : undefined;
      save();
      say(c.resolved ? `Resolved #${numberOf(c)} — it won't be copied to Claude` : `Reopened #${numberOf(c)}`);
    }
    if (act === "copy-one") {
      const ok = await copyText(toMarkdown({ only: [c] }));
      say(ok ? `Copied comment #${numberOf(c)} — paste into Claude` : "Copy blocked — use the .md download");
    }
    if (act === "remove") {
      state.comments = state.comments.filter((x) => x.id !== c.id);
      save();
    }
  });

  async function copyMarkdown() {
    const open = openComments();
    if (!open.length) return say(state.comments.length ? "Every comment is resolved — nothing to copy" : "No comments to copy yet");
    const ok = await copyText(toMarkdown());
    say(ok ? `Copied ${open.length} open comment${open.length === 1 ? "" : "s"} — paste into Claude` : "Copy blocked — use the .md download");
  }

  /* ---------- drawing ---------- */
  const DPR = () => window.devicePixelRatio || 1;
  let drawingStroke = null;
  const pendingText = new Set(); // commit functions of text boxes still open

  function sizeBoard() {
    const dpr = DPR();
    board.width = Math.round(innerWidth * dpr);
    board.height = Math.round(innerHeight * dpr);
    paint();
  }

  function drawStroke(c, s, scale) {
    c.save();
    c.scale(scale, scale);
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (s.tool === "pen" || s.tool === "marker") {
      c.globalAlpha = s.tool === "marker" ? 0.35 : 1;
      c.lineWidth = s.tool === "marker" ? 16 : 3;
      c.beginPath();
      s.points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (s.points.length === 1) c.lineTo(s.points[0].x + 0.1, s.points[0].y);
      c.stroke();
    } else if (s.tool === "arrow") {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      c.beginPath();
      c.moveTo(b.x, b.y);
      c.lineTo(b.x - 16 * Math.cos(ang - 0.45), b.y - 16 * Math.sin(ang - 0.45));
      c.lineTo(b.x - 16 * Math.cos(ang + 0.45), b.y - 16 * Math.sin(ang + 0.45));
      c.closePath();
      c.fill();
    } else if (s.tool === "box") {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]];
      c.lineWidth = 3;
      c.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (s.tool === "text") {
      c.font = '600 18px "IBM Plex Sans", system-ui, sans-serif';
      c.textBaseline = "top";
      String(s.text)
        .split("\n")
        .forEach((line, i) => {
          c.lineWidth = 4;
          c.strokeStyle = "rgba(255,255,255,0.9)";
          c.strokeText(line, s.points[0].x, s.points[0].y + i * 23);
          c.fillText(line, s.points[0].x, s.points[0].y + i * 23);
        });
    }
    c.restore();
  }

  function paint() {
    ctx.clearRect(0, 0, board.width, board.height);
    const dpr = DPR();
    state.strokes.forEach((s) => drawStroke(ctx, s, dpr));
    if (drawingStroke) drawStroke(ctx, drawingStroke, dpr);
  }

  function selectTool(tool) {
    state.tool = tool;
    root.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    board.style.cursor = tool === "text" ? "text" : "crosshair";
  }

  function selectColor(color) {
    state.color = color;
    root.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === color)));
  }

  board.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = { x: e.clientX, y: e.clientY };
    if (state.tool === "text") {
      // Keep the press from moving focus to <body>, which would blur the new
      // text box before a single letter lands in it.
      e.preventDefault();
      return placeText(p);
    }
    board.setPointerCapture(e.pointerId);
    drawingStroke = { tool: state.tool, color: state.color, points: [p] };
    paint();
  });
  board.addEventListener("pointermove", (e) => {
    if (!drawingStroke) return;
    const p = { x: e.clientX, y: e.clientY };
    if (drawingStroke.tool === "pen" || drawingStroke.tool === "marker") drawingStroke.points.push(p);
    else drawingStroke.points[1] = p;
    paint();
  });
  const endStroke = () => {
    if (!drawingStroke) return;
    state.strokes.push(drawingStroke);
    drawingStroke = null;
    paint();
  };
  board.addEventListener("pointerup", endStroke);
  board.addEventListener("pointercancel", endStroke);

  function placeText(p) {
    const box = document.createElement("div");
    box.className = "textentry";
    box.contentEditable = "true";
    box.style.left = p.x + "px";
    box.style.top = p.y + "px";
    box.style.color = state.color;
    ui.appendChild(box);
    const born = performance.now();
    const focusBox = () => box.isConnected && root.activeElement !== box && box.focus();
    focusBox();
    setTimeout(focusBox, 0);
    setTimeout(focusBox, 120);
    let done = false;
    const commit = (force) => {
      if (done || !box.isConnected) return;
      const text = box.innerText.trim();
      // An empty box that lost focus straight away was never really left:
      // the click that made it stole focus back. Hold on to it.
      if (!text && !force && performance.now() - born < 400) {
        setTimeout(focusBox, 0);
        return;
      }
      // Mark it done first: removing a focused box fires blur, which calls back in here.
      done = true;
      pendingText.delete(commit);
      box.remove();
      if (text) {
        state.strokes.push({ tool: "text", color: state.color, points: [{ x: p.x + 5, y: p.y + 3 }], text });
        paint();
      }
    };
    box.addEventListener("blur", () => commit(false));
    // Text still being typed when an export starts goes into the image too.
    pendingText.add(commit);
    box.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
        e.preventDefault();
        box.blur();
      }
    });
  }

  function loadScript(src) {
    return new Promise((resolveLoad, reject) => {
      if (window.html2canvas) return resolveLoad();
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolveLoad();
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  async function captureRendered() {
    await loadScript(H2C_URL);
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    const bg = [bodyBg, htmlBg].find((c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") || "#ffffff";
    // html2canvas can't read a playing <video> (it clones it to a blank
    // canvas), so videos come out black. For the moment of the capture, stand
    // a still of each video's current frame in its place, then put it back.
    const swaps = [];
    document.querySelectorAll("video").forEach((v) => {
      try {
        if (!v.videoWidth || v.readyState < 2) return;
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        const img = document.createElement("img");
        img.src = c.toDataURL("image/png");
        img.className = v.className;
        img.setAttribute("style", v.getAttribute("style") || "");
        const cs = getComputedStyle(v);
        img.style.objectFit = cs.objectFit;
        img.style.objectPosition = cs.objectPosition;
        img.setAttribute("aria-hidden", "true");
        img.setAttribute("data-pf-frame", "");
        swaps.push({ v, img, display: v.style.display });
      } catch (e) {
        /* a cross-origin video without CORS can't be read; it stays black */
      }
    });
    await Promise.all(swaps.map(({ img }) => img.decode().catch(() => {})));
    swaps.forEach(({ v, img }) => {
      v.before(img);
      v.style.display = "none";
    });
    try {
      return await window.html2canvas(document.documentElement, {
        x: scrollX,
        y: scrollY,
        width: innerWidth,
        height: innerHeight,
        windowWidth: innerWidth,
        windowHeight: innerHeight,
        scale: DPR(),
        useCORS: true,
        logging: false,
        backgroundColor: bg,
        ignoreElements: (el) => el === host || el.tagName === "PRISM-FEEDBACK",
        // Animated wrappers (filters, 3D perspective, running transforms) can
        // make html2canvas drop everything inside them. Flatten them in its
        // private copy only; the live page is untouched.
        onclone: (doc) => {
          // html2canvas paints a radial gradient with see-through stops (a
          // vignette, a glow) as a solid block, which hides whatever is under
          // it. In the copy only, drop those; losing a soft vignette is far
          // better than a black box over the page.
          const win = doc.defaultView;
          doc.querySelectorAll("body *").forEach((el) => {
            const bgi = win.getComputedStyle(el).backgroundImage;
            if (bgi && bgi.includes("radial-gradient") && /rgba\([^)]*,\s*0(\.0+)?\)|transparent/.test(bgi)) el.style.backgroundImage = "none";
          });
          doc.querySelectorAll("img[data-pf-frame]").forEach((img) => {
            for (let n = img.parentElement; n && n !== doc.body; n = n.parentElement) {
              n.style.filter = "none";
              n.style.transform = "none";
              n.style.perspective = "none";
              n.style.willChange = "auto";
            }
          });
        },
      });
    } finally {
      swaps.forEach(({ v, img, display }) => {
        img.remove();
        v.style.display = display;
      });
    }
  }

  async function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error("Screen capture unsupported");
    host.style.visibility = "hidden";
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d").drawImage(video, 0, 0);
      return c;
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      host.style.visibility = "";
    }
  }

  function wrapLines(c, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach((w) => {
      const test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  async function exportDrawing() {
    [...pendingText].forEach((commit) => commit(true));
    const mode = bgSelect.value;
    let base = null;
    let used = mode;
    if (mode === "page") {
      try {
        base = await captureRendered();
      } catch (e) {
        used = "screen";
        say("Page render unavailable — asking for a screen capture");
      }
    }
    if (!base && used === "screen") {
      try {
        base = await captureScreen();
      } catch (e) {
        used = "none";
        say("Screen capture declined — exporting the drawing only");
      }
    }
    const dpr = DPR();
    const W = base ? base.width : Math.round(innerWidth * dpr);
    const H = base ? base.height : Math.round(innerHeight * dpr);
    const k = W / innerWidth; // pixels per CSS px in the final image
    const note = noteInput.value.trim();
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `600 ${15 * k}px "IBM Plex Sans", system-ui, sans-serif`;
    const noteLines = note ? wrapLines(measure, note, W - 32 * k) : [];
    const footer = Math.round((noteLines.length * 22 + 44) * k);

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H + footer;
    const c = out.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H + footer);
    if (base) c.drawImage(base, 0, 0, W, H);
    state.strokes.forEach((s) => drawStroke(c, s, k));
    c.fillStyle = "#F6F6F9";
    c.fillRect(0, H, W, footer);
    c.fillStyle = "#DDDFE5";
    c.fillRect(0, H, W, Math.max(1, k));
    let y = H + 14 * k;
    c.textBaseline = "top";
    c.fillStyle = "#2B2A35";
    c.font = `600 ${15 * k}px "IBM Plex Sans", system-ui, sans-serif`;
    noteLines.forEach((l) => {
      c.fillText(l, 16 * k, y);
      y += 22 * k;
    });
    c.fillStyle = "#545465";
    c.font = `400 ${12 * k}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    c.fillText(
      `${titleLine()} · ${innerWidth}×${innerHeight} · ${location.hash || location.pathname} · ${stamp()}${used === "none" ? " · drawing only" : ""}`,
      16 * k,
      y
    );
    state.lastImage = out.toDataURL("image/png");
    return out;
  }

  const toBlob = (canvas) => new Promise((r) => canvas.toBlob((b) => r(b), "image/png"));

  async function copyImage() {
    const btn = $('[data-act="copy-image"]');
    btn.disabled = true;
    say("Capturing…", 8000);
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        let canvas;
        const blobPromise = exportDrawing().then((cv) => ((canvas = cv), toBlob(cv)));
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
          say("Image copied — paste it into Claude");
          return;
        } catch (e) {
          await blobPromise.catch(() => null);
          if (canvas) {
            download(fileBase() + ".png", canvas.toDataURL("image/png"));
            say("Clipboard blocked — PNG downloaded instead");
            return;
          }
          throw e;
        }
      }
      const canvas = await exportDrawing();
      download(fileBase() + ".png", canvas.toDataURL("image/png"));
      say("Clipboard images unsupported — PNG downloaded instead");
    } catch (e) {
      say("Could not export the drawing: " + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  async function downloadImage() {
    say("Capturing…", 8000);
    try {
      const canvas = await exportDrawing();
      download(fileBase() + ".png", canvas.toDataURL("image/png"));
      say("PNG downloaded — attach it in Claude");
    } catch (e) {
      say("Could not export the drawing");
    }
  }

  /* ---------- wiring ---------- */
  root.addEventListener("click", (e) => {
    const toolBtn = e.target.closest("[data-tool]");
    if (toolBtn) return selectTool(toolBtn.dataset.tool);
    const sw = e.target.closest("[data-color]");
    if (sw) return selectColor(sw.dataset.color);
    const btn = e.target.closest("[data-act]");
    if (!btn || pop.contains(btn) || $(".list").contains(btn)) return;
    switch (btn.dataset.act) {
      case "toggle-dock":
        setDock(!state.expanded);
        if (!state.expanded) {
          setMode("idle");
          setPanel(false);
        }
        break;
      case "mode-comment":
        setMode("comment");
        break;
      case "mode-draw":
        setMode("draw");
        break;
      case "toggle-panel":
        setPanel(!state.panelOpen);
        break;
      case "close-panel":
        setPanel(false);
        break;
      case "copy-md":
        copyMarkdown();
        break;
      case "filter-open":
      case "filter-resolved":
      case "filter-all":
        state.filter = btn.dataset.act.slice("filter-".length);
        render();
        break;
      case "download-md":
        if (!openComments().length) return say(state.comments.length ? "Every comment is resolved — nothing to download" : "No comments to download yet");
        download(fileBase() + ".md", "data:text/markdown;charset=utf-8," + encodeURIComponent(toMarkdown()));
        break;
      case "clear-all":
        if (state.comments.length && confirm(`Delete all ${state.comments.length} comments on this page?`)) {
          state.comments = [];
          save();
        }
        break;
      case "swap-side":
        state.prefs.corner = state.prefs.corner === "left" ? "right" : "left";
        store.write(PREF_KEY, state.prefs);
        applyCorner();
        break;
      case "undo":
        state.strokes.pop();
        paint();
        break;
      case "clear":
        state.strokes = [];
        paint();
        break;
      case "copy-image":
        copyImage();
        break;
      case "download-image":
        downloadImage();
        break;
      case "exit-draw":
        setMode("idle");
        break;
    }
  });

  document.addEventListener(
    "keydown",
    (e) => {
      const inField = fromUI(e) && /^(TEXTAREA|INPUT|SELECT)$/.test((e.composedPath()[0] || {}).tagName || "");
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const k = e.code;
        if (k === "KeyC" || k === "KeyD" || k === "KeyF" || k === "KeyH") {
          e.preventDefault();
          e.stopPropagation();
          if (k === "KeyC") (setDock(true), setMode("comment"));
          if (k === "KeyD") setMode("draw");
          if (k === "KeyF") setDock(!state.expanded);
          if (k === "KeyH") {
            state.hidden = !state.hidden;
            ui.hidden = state.hidden;
            if (!state.hidden) positionPins(false);
          }
          return;
        }
      }
      if (e.key === "Escape" && !inField) {
        if (state.pick) closePop();
        else if (state.mode !== "idle") setMode("idle");
        else if (state.panelOpen) setPanel(false);
        return;
      }
      if (state.mode === "draw" && !inField && !e.target.isContentEditable && !(fromUI(e) && (e.composedPath()[0] || {}).isContentEditable)) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          state.strokes.pop();
          paint();
          return;
        }
        const map = { p: "pen", h: "marker", a: "arrow", b: "box", t: "text" };
        if (!e.metaKey && !e.ctrlKey && !e.altKey && map[e.key.toLowerCase()]) {
          e.preventDefault();
          selectTool(map[e.key.toLowerCase()]);
        }
      }
    },
    true
  );

  /* ---------- mount ---------- */
  function mount() {
    if (host.isConnected) return;
    document.body.appendChild(host);
    applyCorner();
    render();
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  // Frameworks that re-render the body can drop the host; put it back.
  new MutationObserver(() => {
    if (!host.isConnected && document.body) mount();
  }).observe(document.documentElement, { childList: true, subtree: false });
  if (document.body) new MutationObserver(() => !host.isConnected && mount()).observe(document.body, { childList: true });

  window.prismFeedback = {
    version: VERSION,
    meta: Object.assign({}, META),
    comments: () => state.comments.map(({ _el, ...rest }) => rest),
    toMarkdown,
    copy: copyMarkdown,
    clear() {
      state.comments = [];
      save();
    },
    setMode,
    open: () => (setDock(true), setPanel(true)),
    exportDrawing: async () => (await exportDrawing()).toDataURL("image/png"),
    get lastImage() {
      return state.lastImage;
    },
  };
})();

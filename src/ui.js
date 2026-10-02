// Small helpers for building the page. Everything players typed is put in with text nodes (h's
// string children), never as HTML, so it can't run as code.

// h("button", { class: "x", on: { click: fn }, disabled: true }, "text", child, ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const BIG = [[1e15, "Qa"], [1e12, "T"], [1e9, "B"], [1e6, "M"]];
// 1234 → "1,234"; 2500000 → "2.50 M"
export function fmt(n) {
  n = Math.floor(+n || 0);
  for (const [v, s] of BIG) if (n >= v) return (n / v).toFixed(2) + " " + s;
  return n.toLocaleString("en-US");
}
// Smaller numbers for rates: "0.5", "12", "1,234"
export const fmtRate = n => n < 10 && n % 1 ? n.toFixed(1) : fmt(n);

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// 754000 → "12:34"; 9000000 → "2:30:00"
export const clock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

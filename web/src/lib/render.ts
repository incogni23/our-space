"use client";

// One renderer for the live preview and the exported image (what you see is what
// you export). Draws into a canvas from a design spec; photos come from our API
// (same origin, so the canvas stays exportable). Canvas output carries no metadata.

import { photoUrl } from "./api";

export type Layout = "grid" | "film" | "loose" | "softlaunch";
export type Size = "post" | "story" | "square";
export type CaptionStyle = "serif" | "sans" | "stamp";
export type Background = "paper" | "ivory" | "plum" | "sage";
export type Reveal = "faceless" | "hint" | "full";

export type Spec = {
  photos: string[];
  layout: Layout;
  size: Size;
  caption: string;
  captionStyle: CaptionStyle;
  background: Background;
  gap: number; // 0–20
  reveal: Reveal;
  focus: { x: number; y: number }; // 0–1, soft launch crop centre
  sticker: string; // e.g. "a + d"
  dateStamp: string; // e.g. "17 · 10 · 25", empty to hide
};

export const SIZES: Record<Size, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: "4:5 post" },
  story: { w: 1080, h: 1920, label: "9:16 story" },
  square: { w: 1080, h: 1080, label: "1:1 square" },
};

export const BACKGROUNDS: Record<Background, { fill: string; ink: string; label: string }> = {
  paper: { fill: "#FFFCF7", ink: "#44353E", label: "Paper" },
  ivory: { fill: "#F7F2EA", ink: "#44353E", label: "Ivory" },
  plum: { fill: "#44353E", ink: "#F3EBE1", label: "Plum" },
  sage: { fill: "#E6EADF", ink: "#44353E", label: "Sage" },
};

export function defaultSpec(format: "collage" | "softlaunch", photos: string[], caption: string, sticker: string): Spec {
  const d = new Date();
  return {
    photos: format === "softlaunch" ? photos.slice(0, 1) : photos.slice(0, 4),
    layout: format === "softlaunch" ? "softlaunch" : "grid",
    size: format === "softlaunch" ? "story" : "post",
    caption,
    captionStyle: "serif",
    background: "paper",
    gap: 8,
    reveal: "hint",
    focus: { x: 0.5, y: 0.5 },
    sticker,
    dateStamp: `${d.getDate()} · ${d.getMonth() + 1} · ${String(d.getFullYear()).slice(2)}`,
  };
}

function cssFont(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

const cache = new Map<string, Promise<HTMLImageElement>>();

function loadPhoto(id: string): Promise<HTMLImageElement> {
  let p = cache.get(id);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("photo"));
      img.src = photoUrl(id, "full");
    });
    cache.set(id, p);
  }
  return p;
}

/** object-fit: cover, around a focus point, optionally zoomed in. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, focus = { x: 0.5, y: 0.5 }, zoom = 1) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.min(Math.max(focus.x * img.naturalWidth - sw / 2, 0), img.naturalWidth - sw);
  const sy = Math.min(Math.max(focus.y * img.naturalHeight - sh / 2, 0), img.naturalHeight - sh);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function placeholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#E7DED2";
  ctx.fillRect(x, y, w, h);
}

function caption(ctx: CanvasRenderingContext2D, spec: Spec, x: number, y: number, maxW: number, ink: string, s: number, fonts: Fonts) {
  if (!spec.caption.trim()) return;
  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  let text = spec.caption.trim();
  if (spec.captionStyle === "serif") ctx.font = `italic 400 ${Math.round(56 * s)}px ${fonts.serif}`;
  else if (spec.captionStyle === "sans") ctx.font = `500 ${Math.round(46 * s)}px ${fonts.sans}`;
  else {
    ctx.font = `500 ${Math.round(34 * s)}px ${fonts.mono}`;
    text = text.toUpperCase();
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(5 * s)}px`;
  }
  while (ctx.measureText(text).width > maxW && text.length > 1) text = text.slice(0, -2) + "…";
  ctx.fillText(text, x, y);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

type Fonts = { serif: string; sans: string; mono: string };

function gridCells(n: number, x: number, y: number, w: number, h: number, g: number): Array<[number, number, number, number]> {
  if (n <= 1) return [[x, y, w, h]];
  if (n === 2) return [[x, y, (w - g) / 2, h], [x + (w + g) / 2, y, (w - g) / 2, h]];
  if (n === 3) {
    const top = (h - g) * 0.58;
    return [[x, y, w, top], [x, y + top + g, (w - g) / 2, h - top - g], [x + (w + g) / 2, y + top + g, (w - g) / 2, h - top - g]];
  }
  const cols = n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = (w - g * (cols - 1)) / cols;
  const rh = (h - g * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => [x + (i % cols) * (cw + g), y + Math.floor(i / cols) * (rh + g), cw, rh] as [number, number, number, number]);
}

/** Draws the design into `canvas` at full export size. */
export async function render(canvas: HTMLCanvasElement, spec: Spec): Promise<void> {
  const { w: W, h: H } = SIZES[spec.size];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const s = W / 1080;
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
  const fonts: Fonts = {
    serif: cssFont("--font-newsreader", "Georgia, serif"),
    sans: cssFont("--font-dm-sans", "system-ui, sans-serif"),
    mono: cssFont("--font-dm-mono", "ui-monospace, monospace"),
  };
  const imgs = await Promise.all(spec.photos.map((id) => loadPhoto(id).catch(() => null)));
  const bg = BACKGROUNDS[spec.background];
  ctx.clearRect(0, 0, W, H);

  if (spec.layout === "softlaunch") {
    ctx.fillStyle = "#2E2329";
    ctx.fillRect(0, 0, W, H);
    const img = imgs[0];
    const zoom = spec.reveal === "faceless" ? 2.4 : spec.reveal === "hint" ? 1.35 : 1;
    if (img) drawCover(ctx, img, 0, 0, W, H, spec.focus, zoom);
    else placeholder(ctx, 0, 0, W, H);
    // a soft fade so white text reads on any photo
    const grad = ctx.createLinearGradient(0, H * 0.62, 0, H);
    grad.addColorStop(0, "rgba(46,35,41,0)");
    grad.addColorStop(1, "rgba(46,35,41,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
    if (spec.reveal !== "faceless" && spec.sticker.trim()) {
      ctx.save();
      ctx.translate(W * 0.8, H * 0.1);
      ctx.rotate((6 * Math.PI) / 180);
      ctx.font = `italic 400 ${Math.round(58 * s)}px ${fonts.serif}`;
      const tw = ctx.measureText(spec.sticker).width;
      const ph = 92 * s;
      ctx.fillStyle = "#FFFCF7";
      ctx.beginPath();
      ctx.roundRect(-tw / 2 - 30 * s, -ph / 2, tw + 60 * s, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = "#8E4D4F";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.sticker, 0, 4 * s);
      ctx.restore();
    }
    if (spec.reveal !== "faceless" && spec.dateStamp.trim()) {
      ctx.font = `500 ${Math.round(36 * s)}px ${fonts.mono}`;
      ctx.fillStyle = "#E8A27C";
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(spec.dateStamp, W * 0.92, H * 0.96);
    }
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(30,20,20,0.45)";
    ctx.shadowBlur = 18 * s;
    caption(ctx, spec, W * 0.08, H * 0.9, W * (spec.reveal === "faceless" ? 0.84 : 0.6), "#FFFCF7", s, fonts);
    ctx.shadowBlur = 0;
    return;
  }

  if (spec.layout === "film") {
    ctx.fillStyle = "#2E2329";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(243,235,225,0.85)";
    for (const sx of [W * 0.04, W * 0.91]) {
      for (let yy = 20 * s; yy < H; yy += 44 * s) {
        ctx.beginPath();
        ctx.roundRect(sx, yy, W * 0.05, 24 * s, 4 * s);
        ctx.fill();
      }
    }
    const n = Math.max(1, Math.min(imgs.length, 4));
    const top = H * 0.04;
    const bottom = H * 0.1;
    const g = spec.gap * 3 * s;
    const fh = (H - top - bottom - g * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const img = imgs[i];
      const yy = top + i * (fh + g);
      if (img) drawCover(ctx, img, W * 0.14, yy, W * 0.72, fh);
      else placeholder(ctx, W * 0.14, yy, W * 0.72, fh);
    }
    caption(ctx, { ...spec, captionStyle: "stamp" }, W * 0.14, H * 0.965, W * 0.72, "#DDA09D", s, fonts);
    return;
  }

  ctx.fillStyle = bg.fill;
  ctx.fillRect(0, 0, W, H);

  if (spec.layout === "loose") {
    const slots: Array<[number, number, number, number, number]> = [
      [0.08, 0.08, 0.54, 0.38, -4],
      [0.53, 0.14, 0.4, 0.34, 5],
      [0.12, 0.46, 0.42, 0.32, 3],
      [0.45, 0.44, 0.46, 0.36, -2],
    ];
    const n = Math.max(1, Math.min(imgs.length, 4));
    for (let i = 0; i < n; i++) {
      const [fx, fy, fw, fh, rot] = slots[i];
      const x = fx * W;
      const y = fy * H;
      const w = fw * W;
      const h = fh * H;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.shadowColor = "rgba(46,35,41,0.35)";
      ctx.shadowBlur = 30 * s;
      ctx.shadowOffsetY = 14 * s;
      ctx.fillStyle = "#FFFCF7";
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.shadowColor = "transparent";
      const pad = 0.025 * W;
      const img = imgs[i];
      if (img) drawCover(ctx, img, -w / 2 + pad, -h / 2 + pad, w - 2 * pad, h - 2 * pad);
      else placeholder(ctx, -w / 2 + pad, -h / 2 + pad, w - 2 * pad, h - 2 * pad);
      ctx.restore();
    }
    caption(ctx, spec, W * 0.08, H * 0.95, W * 0.84, bg.ink, s, fonts);
    return;
  }

  // grid
  const m = W * 0.06;
  const capArea = H * 0.16;
  const g = spec.gap * 4 * s;
  const n = Math.max(1, Math.min(imgs.length, 6));
  gridCells(n, m, m, W - 2 * m, H - m - capArea, g).forEach(([x, y, w, h], i) => {
    const img = imgs[i];
    if (img) drawCover(ctx, img, x, y, w, h);
    else placeholder(ctx, x, y, w, h);
  });
  caption(ctx, spec, m, H - capArea * 0.38, W - 2 * m, bg.ink, s, fonts);
}

export function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.92));
}

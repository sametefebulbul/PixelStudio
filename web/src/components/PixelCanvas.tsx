import { useEffect, useRef, useState } from "react";
import type { Comment } from "../types";

export type Region = [number, number, number, number];

interface Props {
  src?: string;
  size: number; // sprite size in px (canvas logical size)
  zoom: number;
  grid: boolean;
  bg: "dark" | "light" | "checker";
  comments: (Comment & { index: number })[];
  draft?: Region | null;
  onSelect?: (r: Region) => void;
  onHover?: (p: [number, number] | null) => void;
}

const BG = { dark: "#241b14", light: "#d8ccb4" };

/** Pixel-exact sprite view: nearest-neighbour zoom, optional grid, drag to select a region, numbered comment pins. */
export function PixelCanvas({ src, size, zoom, grid, bg, comments, draft, onSelect, onHover }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const W = size * zoom;

  useEffect(() => {
    if (!src) return setImg(null);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = W;
    c.height = W;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    if (bg === "checker") {
      const s = Math.max(4, zoom);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        g.fillStyle = (x + y) % 2 ? "#3a3029" : "#2c241e";
        g.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
      void s;
    } else {
      g.fillStyle = BG[bg];
      g.fillRect(0, 0, W, W);
    }
    if (img) g.drawImage(img, 0, 0, W, W);
    if (grid && zoom >= 6) {
      g.strokeStyle = "rgba(255,255,255,0.07)";
      g.lineWidth = 1;
      for (let i = 0; i <= size; i++) {
        g.beginPath(); g.moveTo(i * zoom + 0.5, 0); g.lineTo(i * zoom + 0.5, W); g.stroke();
        g.beginPath(); g.moveTo(0, i * zoom + 0.5); g.lineTo(W, i * zoom + 0.5); g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.14)";
      for (let i = 0; i <= size; i += 8) {
        g.beginPath(); g.moveTo(i * zoom + 0.5, 0); g.lineTo(i * zoom + 0.5, W); g.stroke();
        g.beginPath(); g.moveTo(0, i * zoom + 0.5); g.lineTo(W, i * zoom + 0.5); g.stroke();
      }
    }
    const box = (r: Region, color: string, label?: string, dash = false) => {
      const [x0, y0, x1, y1] = r;
      g.save();
      g.strokeStyle = color;
      g.lineWidth = 2;
      if (dash) g.setLineDash([6, 4]);
      g.strokeRect(x0 * zoom + 1, y0 * zoom + 1, (x1 - x0 + 1) * zoom - 2, (y1 - y0 + 1) * zoom - 2);
      g.fillStyle = color.replace(")", ",0.10)").replace("rgb", "rgba");
      g.fillRect(x0 * zoom, y0 * zoom, (x1 - x0 + 1) * zoom, (y1 - y0 + 1) * zoom);
      if (label) {
        g.setLineDash([]);
        g.fillStyle = color;
        g.beginPath();
        g.arc(x0 * zoom + 2, y0 * zoom + 2, 10, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#1b1409";
        g.font = "bold 11px system-ui";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, x0 * zoom + 2, y0 * zoom + 3);
      }
      g.restore();
    };
    for (const cm of comments) box(cm.region, cm.status === "applied" ? "rgb(124,195,106)" : cm.status === "rejected" ? "rgb(138,123,101)" : "rgb(224,176,74)", String(cm.index));
    const sel = drag ? norm(drag.a, drag.b) : draft;
    if (sel) box(sel, "rgb(127,182,217)", undefined, true);
  }, [img, size, zoom, grid, bg, comments, drag, draft, W]);

  const toPx = (e: React.MouseEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width;
    const sy = (e.clientY - r.top) / r.height;
    return [Math.max(0, Math.min(size - 1, Math.floor(sx * size))), Math.max(0, Math.min(size - 1, Math.floor(sy * size)))];
  };

  return (
    <canvas
      ref={ref}
      style={{ width: Math.min(W, 640), height: Math.min(W, 640) }}
      onMouseDown={(e) => onSelect && setDrag({ a: toPx(e), b: toPx(e) })}
      onMouseMove={(e) => {
        const p = toPx(e);
        onHover?.(p);
        if (drag) setDrag({ ...drag, b: p });
      }}
      onMouseLeave={() => onHover?.(null)}
      onMouseUp={() => {
        if (drag && onSelect) onSelect(norm(drag.a, drag.b));
        setDrag(null);
      }}
    />
  );
}

function norm(a: [number, number], b: [number, number]): Region {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

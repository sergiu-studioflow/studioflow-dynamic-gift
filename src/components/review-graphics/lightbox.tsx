"use client";

import { useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/** Full-screen image viewer: click outside / X to close; arrows for multi-image sets. */
export function Lightbox({ images, onClose, start = 0 }: { images: string[]; onClose: () => void; start?: number }) {
  const [i, setI] = useState(start);
  if (images.length === 0) return null;
  const prev = () => setI((n) => (n - 1 + images.length) % images.length);
  const next = () => setI((n) => (n + 1) % images.length);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 top-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 top-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {i + 1} / {images.length}
          </span>
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[i]}
        alt="preview"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}

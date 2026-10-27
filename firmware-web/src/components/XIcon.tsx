"use client";
// X (Twitter) link icon. Uses X's official logo file if you add it at public/brand/x-logo.svg
// (white version, from X's brand toolkit); falls back to the pixel glyph until then.
import { useEffect, useRef, useState } from "react";
import PixelIcon from "./PixelIcon";

export default function XIcon({ size = 12, className = "" }: { size?: number; className?: string }) {
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // the image may have failed before React attached onError (server-rendered), so check on mount too
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);
  if (missing) return <PixelIcon name="x" size={size} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src="/brand/x-logo.svg" alt="" width={size} height={size} onError={() => setMissing(true)} className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size }} />;
}

/** Triskel-Symbol (Farbkreis): Bild mit durchsichtigem Grund, in Hell und Dunkel lesbar. */
export function TriskelMark({
  size = 16,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    // biome-ignore lint/performance/noImgElement: kleines festes Symbol, keine Optimierung nötig
    <img
      src="/triskel.png"
      alt=""
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}

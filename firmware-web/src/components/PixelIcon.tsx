// Pixel-art icons in the Hypeware brand style. Each icon is a grid: x = cream, c = cyan, l = lime, r = red.
const C: Record<string, string> = { x: "#e8f1ff", c: "#38d9ff", l: "#4d7cff", r: "#7aa7ff" };

export const ICONS = {
  search: ["..xxxx....", ".x....x...", "x......x..", "x..c...x..", "x......x..", ".x....x...", "..xxxxxx..", "......xxx.", ".......xxx", "........xx"],
  browser: ["xxxxxxxxxx", "x.r.l.c..x", "xxxxxxxxxx", "x........x", "x.xxxxx..x", "x........x", "x.xxx....x", "x........x", "xxxxxxxxxx"],
  click: ["x.......", "xx......", "x.x.....", "x..x....", "x...x...", "x....x..", "x..xxxx.", "x.x.....", "xx......", "x......c"],
  type: ["xxxxxxxxxx", "x........x", "x.x.x.x.lx", "x........x", "x.xxxxxx.x", "x........x", "xxxxxxxxxx"],
  code: ["......l....", "..x...x.x..", ".x...x...x.", "x....x....x", ".x..x....x.", "..x.x...x.."],
  doc: ["xxxxx...", "x...xx..", "x.xx.xx.", "x......x", "x.xxxx.x", "x......x", "x.xx..cx", "xxxxxxxx"],
  palette: [".xxxxxx..", "x......x.", "x.l..c..x", "x.......x", "x..r...x.", "x....xx..", ".x..x....", "..xx....."],
  cart: ["x.........", "xxxxxxxxxx", ".x......x.", ".x.c.l.rx.", ".xxxxxxxx.", "..........", "..x....x.."],
  check: ["........x", ".......xx", "x.....xx.", "xx...xx..", ".xx.xx...", "..xxx....", "...x....."],
  coin: ["..xxxxx..", ".x.....x.", "x..lll..x", "x..l....x", "x..lll..x", "x....l..x", "x..lll..x", ".x.....x.", "..xxxxx.."],
  flame: ["....x....", "...xx....", "..xxx.x..", "..xrxxx..", ".xrrrxxx.", ".xrlrrxx.", ".xxllrxx.", "..xxxxx.."],
  send: ["......x...", "......xx..", "xxxxxxxxx.", "xxxxxxxxxx", "xxxxxxxxx.", "......xx..", "......x..."],
  chat: ["xxxxxxxxx.", "x.......x.", "x.c.l.r.x.", "x.......x.", "xxxxxxxxx.", "..xx......", "..x......."],
  memory: ["..x.x.x..", ".xxxxxxx.", "xx.....xx", ".x.c.l.x.", "xx.....xx", ".xxxxxxx.", "..x.x.x.."],
  moon: ["...xxx...", "..xx.....", ".xx......", ".xx......", ".xx.....c", "..xx...x.", "...xxxx.."],
  stop: ["xxxxxxx", "x.....x", "x.xxx.x", "x.xxx.x", "x.xxx.x", "x.....x", "xxxxxxx"],
  calendar: [".x....x.", "xxxxxxxx", "x......x", "x.x.x.lx", "x......x", "x.x.x..x", "xxxxxxxx"],
  chart: ["........c", "......x..", "....x.x..", "..x.x.x..", "x.x.x.x..", "xxxxxxxxx"],
  flow: ["......rr", "......rr", "xxx...x.", "x.x..x..", "xxxxx...", "..x..xxx", "..x..x.x", ".....xxx"],
  research: ["xxxxxx...", "x....x...", "x.xx.x...", "x....xxx.", "x.xxx...x", "x....x.c.x", "xxxxx.x..x", "......xxx.", "........xx"],
  bolt: ["....xx", "...xx.", "..xx..", ".xxxxx", "...xx.", "..xx..", ".xx..."],
  error: ["...x...", "..xxx..", "..x.x..", ".xx.xx.", ".xxrxx.", "xxx.xxx", "xxxxxxx"],
  film: ["xxxxxxxxxx", "x.x.x.x.xx", "xxxxxxxxxx", "x...cc...x", "x...ccc..x", "x...cc...x", "xxxxxxxxxx", "x.x.x.x.xx", "xxxxxxxxxx"],
  x: ["xx....xx", ".xx..xx.", "..xxxx..", "...xx...", "..xxxx..", ".xx..xx.", "xx....xx"],
  eye: ["..xxxxx..", ".x.....x.", "x...c...x", "x..ccc..x", "x...c...x", ".x.....x.", "..xxxxx.."],
} as const;

export type IconName = keyof typeof ICONS;

export default function PixelIcon({ name, size = 18, className = "", glow = true }: { name: IconName; size?: number; className?: string; glow?: boolean }) {
  const g = ICONS[name];
  const w = Math.max(...g.map((r) => r.length));
  const h = g.length;
  const rects: JSX.Element[] = [];
  g.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      if (C[ch]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={C[ch]} />);
    }),
  );
  const scale = size / Math.max(w, h);
  return (
    <svg
      width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={glow ? { filter: "drop-shadow(0 0 3px rgba(232,241,255,.45))" } : undefined}
    >
      {rects}
    </svg>
  );
}

/** Which icon to show for each agent tool. */
export const TOOL_ICON: Record<string, IconName> = {
  web_search: "search", open_url: "browser", click: "click", fill: "type", read_more: "doc",
  write_site_file: "code", read_site_file: "doc", list_site_files: "doc", delete_site_file: "code", set_tagline: "palette",
  create_offer: "cart", update_offer: "cart", deliver_order: "check", check_treasury: "coin", buyback: "flame",
  transfer_sol: "send", generate_image: "palette", generate_video: "film", list_media: "film", image: "palette", video: "film", post_update: "chat", remember: "memory", sleep: "moon", end_shift: "stop",
};

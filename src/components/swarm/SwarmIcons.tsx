import React from "react";

/**
 * The line icons the SWARM screens use.
 *
 * The same geometry as the design mockup, drawn as one-stroke paths that take
 * `currentColor`, so a row's icon is coloured by the row rather than by a
 * second copy of the palette. Decorative by default — every icon here sits
 * beside a text label, and a screen reader that announces both reads the
 * label twice.
 */

type IconProps = {
  size?: number;
  /** Set only when the icon carries meaning no adjacent text does. */
  title?: string;
};

const PATHS = {
  overview: "M4 5h16v14H4zM4 10h16",
  send: "M4 12 20 4l-4 16-4-7z",
  receive: "M12 4v12m0 0 5-5m-5 5-5-5M4 20h16",
  activity: "M3 12h4l2-6 3 12 2-6h7",
  addresses: "M12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4M7.7 16.3l-1.4 1.4",
  shield: "M12 3 5 6v5c0 4 3 6 7 8 4-2 7-4 7-8V6z",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff:
    "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M6.5 6.7C4 8.3 2 12 2 12s3.5 6 10 6c1.6 0 3-.3 4.2-.9M9.9 5.1C10.6 5 11.3 5 12 5c6.5 0 10 7 10 7s-.8 1.6-2.4 3.2",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  key: "M14.5 4a5.5 5.5 0 1 0-4.7 8.4L4 18.2V21h2.8l5.8-5.8A5.5 5.5 0 1 0 14.5 4z",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  warning: "M12 4 2.5 20h19L12 4zM12 10v4M12 17.5v.5",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  refresh: "M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5",
  plus: "M12 5v14M5 12h14",
  check: "M4 12.5 9.5 18 20 6.5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.6v.4",
  chart: "M4 19h16M5 15l4-4.5 3.5 3L19 6.5",
  external: "M14 4h6v6M20 4l-8.5 8.5M18 14v5H5V6h5",
} as const;

export type SwarmIconName = keyof typeof PATHS;

export const SwarmIcon: React.FC<IconProps & { name: SwarmIconName }> = ({ name, size = 18, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    role={title ? "img" : "presentation"}
    aria-hidden={title ? undefined : true}
    aria-label={title}
    focusable="false"
  >
    {title ? <title>{title}</title> : null}
    <path d={PATHS[name]} stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default SwarmIcon;

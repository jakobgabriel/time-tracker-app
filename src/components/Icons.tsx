type Props = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const TimerIcon = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9.5V13l2.5 1.8M9.5 2h5" />
  </svg>
);

export const ListIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

export const GearIcon = (p: Props) => (
  <svg {...base} {...p}>
    {/* Eight teeth on a root circle of 7, tips at 9.3 — generated, not traced,
        so the outline actually closes. The one it replaced was a mangled copy
        whose arcs fell outside the viewBox and drew as loose specks. */}
    <path d="M 10.37 5.19 L 10.47 2.83 L 13.53 2.83 L 13.63 5.19 A 7.0 7.0 0 0 1 15.66 6.03 L 17.40 4.43 L 19.57 6.60 L 17.97 8.34 A 7.0 7.0 0 0 1 18.81 10.37 L 21.17 10.47 L 21.17 13.53 L 18.81 13.63 A 7.0 7.0 0 0 1 17.97 15.66 L 19.57 17.40 L 17.40 19.57 L 15.66 17.97 A 7.0 7.0 0 0 1 13.63 18.81 L 13.53 21.17 L 10.47 21.17 L 10.37 18.81 A 7.0 7.0 0 0 1 8.34 17.97 L 6.60 19.57 L 4.43 17.40 L 6.03 15.66 A 7.0 7.0 0 0 1 5.19 13.63 L 2.83 13.53 L 2.83 10.47 L 5.19 10.37 A 7.0 7.0 0 0 1 6.03 8.34 L 4.43 6.60 L 6.60 4.43 L 8.34 6.03 A 7.0 7.0 0 0 1 10.37 5.19 Z" />
    <circle cx="12" cy="12" r="3.1" />
  </svg>
);

export const ChartIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M5 20V11M12 20V5M19 20v-6" />
  </svg>
);

export const PlusIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const PlayIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18" fill="currentColor" strokeWidth={1.2}>
    <path d="M7.5 5.2v13.6L18.8 12z" />
  </svg>
);

export const TableIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9.5h18M3 14.5h18M9 9.5v10M15 9.5v10" />
  </svg>
);

export const PinIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <path d="M12 17v4M9.5 3h5l-.6 5.2 2.6 2.4V13H7.5v-2.4l2.6-2.4z" />
  </svg>
);

export const SplitIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    {/* One session became two. A dashed "cut here" line read as a crosshair. */}
    <rect x="4.5" y="3" width="15" height="7" rx="1.8" />
    <rect x="4.5" y="14" width="15" height="7" rx="1.8" />
  </svg>
);

export const MergeIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    {/* The next entry pulled up into this one. Drawn from the same block as
        SplitIcon so the pair reads as one idea; the git-merge glyph it
        replaced had both branches on the same x and drew as a single line. */}
    <rect x="4.5" y="3" width="15" height="7" rx="1.8" />
    <path d="M12 21v-7M9.4 16.6 12 14l2.6 2.6" />
  </svg>
);

export const TrashIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 12.1A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </svg>
);

export const ArchiveIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <rect x="3" y="4" width="18" height="4.6" rx="1.3" />
    <path d="M5 8.6v9.9A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8.6" />
    <path d="M10 12.4h4" />
  </svg>
);

export const NoteIcon = (p: Props) => (
  <svg {...base} {...p} width="16" height="16">
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const SyncIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <path d="M4.52 10.68A7.6 7.6 0 0 1 19.48 10.68M16.94 8.13 19.48 10.68 21.01 7.42" />
    <path d="M19.48 13.32A7.6 7.6 0 0 1 4.52 13.32M7.06 15.87 4.52 13.32 2.99 16.58" />
  </svg>
);

export const ReceiptIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <path d="M6 3.5h12v16l-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" />
    <path d="M9 8.5h6M9 12h6M9 15.5h3" />
  </svg>
);

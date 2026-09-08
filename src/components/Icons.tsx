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
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.55-1H1.3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 7 4.6h.1A1.7 1.7 0 0 0 8.7 3V2.9a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1.7 1.6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.6 1.6h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1.3z" />
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
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </svg>
);

export const CloudIcon = (p: Props) => (
  <svg {...base} {...p} width="18" height="18">
    <path d="M7 18a4 4 0 0 1-.6-7.95 5.5 5.5 0 0 1 10.7-1.3A3.75 3.75 0 0 1 17 18z" />
    <path d="M12 12v5m0 0 2-2m-2 2-2-2" />
  </svg>
);

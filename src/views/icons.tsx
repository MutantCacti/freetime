// Inline SVG icons. Decorative: each sits next to text or inside a control
// that has its own accessible name.

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.6,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false",
} as const;

export const MoonIcon = () => (
  <svg {...base} class="icon icon-moon">
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
  </svg>
);

export const SunIcon = () => (
  <svg {...base} class="icon icon-sun">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
  </svg>
);

export const WarningIcon = () => (
  <svg {...base} class="icon icon-warning">
    <path d="M8 1.8 15 14H1z" />
    <path d="M8 6v3.5M8 11.6v.1" />
  </svg>
);

export const ErrorIcon = () => (
  <svg {...base} class="icon icon-error">
    <circle cx="8" cy="8" r="6.5" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
  </svg>
);

export const CopyIcon = () => (
  <svg {...base} class="icon">
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} class="icon">
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...base} class="icon">
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
);

export const ChevronLeftIcon = () => (
  <svg {...base} class="icon icon-step" stroke-width={2}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg {...base} class="icon icon-step" stroke-width={2}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const ChevronDownIcon = () => (
  <svg {...base} class="icon icon-chevron">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export const MinimiseIcon = () => (
  <svg {...base} class="icon">
    <path d="M3.5 12.5h9" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base} class="icon">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const CalendarIcon = () => (
  <svg {...base} class="icon">
    <rect x="2" y="3" width="12" height="11" rx="1.5" />
    <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
  </svg>
);

/**
 * A person, made of circles: a head (centre 8, 5.2; r 2.4) and a bigger body
 * circle below it (centre 8, 16.5; r 6.5), the body cut by a larger circle
 * centred on the head (r 9.5), which leaves a rounded shoulder arc. The cut is
 * precomputed as two arcs meeting at (2.54, 12.97) and (13.46, 12.97), so
 * there's no clipPath and no id to keep unique.
 */
export const UserIcon = () => (
  <svg {...base} class="icon icon-user">
    <circle cx="8" cy="5.2" r="2.4" />
    <path d="M2.54 12.97A6.5 6.5 0 0 1 13.46 12.97A9.5 9.5 0 0 1 2.54 12.97Z" />
  </svg>
);

export const UserPlusIcon = () => (
  <svg {...base} class="icon icon-user-plus">
    <circle cx="6.5" cy="5.2" r="2.4" />
    <path d="M1.04 12.97A6.5 6.5 0 0 1 11.96 12.97A9.5 9.5 0 0 1 1.04 12.97Z" />
    <path d="M13.25 3v4.5M11 5.25h4.5" />
  </svg>
);

/** A cog: the settings button. */
export const CogIcon = () => (
  <svg {...base} class="icon icon-cog" stroke-width={1.5}>
    <path d="M6.6 1.6h2.8l.4 1.8 1.3.7 1.7-.7 1.4 2.4-1.4 1.2v1.5l1.4 1.2-1.4 2.4-1.7-.7-1.3.7-.4 1.8H6.6l-.4-1.8-1.3-.7-1.7.7-1.4-2.4 1.4-1.2V7l-1.4-1.2 1.4-2.4 1.7.7 1.3-.7z" />
    <circle cx="8" cy="8" r="2.1" />
  </svg>
);

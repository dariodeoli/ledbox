import type { AdminIconName } from "@/lib/admin-types";

/** Set único de iconos del panel: trazo 1.7 sobre grilla 24, un solo tamaño por uso. */
const ICON_PATHS: Record<AdminIconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  events: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10.5h18" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10.5h18" />
      <path d="M8.6 14.2h1.6M13.8 14.2h1.6M8.6 17.6h1.6M13.8 17.6h1.6" />
    </>
  ),
  clients: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 10.8a3 3 0 1 0 0-5.6M18 19.8a5.4 5.4 0 0 0-2.8-4.6" />
    </>
  ),
  leads: <path d="M4 5h16l-6.2 7.2V20l-3.6-2v-5.8z" />,
  audit: (
    <>
      <path d="M7 4h8.5L19 7.5V20H7z" />
      <path d="M15.5 4v3.5H19" />
      <path d="M9.8 13.6l1.7 1.8 3-3.6" />
      <path d="M9.8 17.6h4.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10.5a5.5 5.5 0 0 1 11 0c0 3.2.8 4.7 1.6 5.5H4.9c.8-.8 1.6-2.3 1.6-5.5z" />
      <path d="M10 19.2a2.1 2.1 0 0 0 4 0" />
    </>
  ),
  budgets: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12.5h6M9 16h4" />
    </>
  ),
  receipt: (
    <>
      <path d="M6.5 3h11v18l-2.2-1.6-2.2 1.6-2.2-1.6L8.7 21l-2.2-1.6z" />
      <path d="M9.5 8.2h5M9.5 12h5" />
    </>
  ),
  finance: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.8v4.4M18 9.8v4.4" />
    </>
  ),
  inventory: (
    <>
      <path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4z" />
      <path d="M3.5 8 12 12l8.5-4M12 12v8" />
    </>
  ),
  suppliers: (
    <>
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h3.6L21 13.2V16h-7z" />
      <circle cx="7" cy="18.4" r="1.7" />
      <circle cx="17" cy="18.4" r="1.7" />
    </>
  ),
  promoters: (
    <>
      <path d="M4 10v4h2.6l7.4 4V6l-7.4 4H4z" />
      <path d="M17 9.2a4 4 0 0 1 0 5.6" />
    </>
  ),
  users: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
      <path d="M9.4 12.4 11.4 14.6l3.6-4.4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </>
  ),
  moon: <path d="M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6z" />,
  logout: (
    <>
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8.6 8.6" />
      <path d="M18 14v5.5A1.5 1.5 0 0 1 16.5 21H5.5A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M15.6 15.6 20 20" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.8l4.6 4.6L19 6.6" />,
  edit: (
    <>
      <path d="M4 20h4.2L19.4 8.8a2.1 2.1 0 0 0-3-3L5.2 16.9z" />
      <path d="M14.8 5.4l3.8 3.8" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6.5 19.5 12l-6 5.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.6M12 17.6v.4" />
    </>
  ),
  power: (
    <>
      <path d="M12 4v7.5" />
      <path d="M7.6 7a6.8 6.8 0 1 0 8.8 0" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M4 7.2l8 5.8 8-5.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4.5V10h-5.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 11v5.6M12 7.6v.5" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3.5h10V9" />
      <path d="M7 19H5.2A1.2 1.2 0 0 1 4 17.8v-7.1A1.2 1.2 0 0 1 5.2 9.5h13.6A1.2 1.2 0 0 1 20 10.7v7.1a1.2 1.2 0 0 1-1.2 1.2H17" />
      <path d="M7 15h10v5.5H7z" />
      <path d="M16.6 12.4h.4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10.4" />
      <path d="M7.6 10.4 12 14.8l4.4-4.4" />
      <path d="M4.5 17.4V19A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4 4.5l16 15" />
      <path d="M9.9 6.2A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.2 4.1" />
      <path d="M6.1 8.2A17.2 17.2 0 0 0 2.5 12s3.5 6.2 9.5 6.2a9.3 9.3 0 0 0 4-.9" />
      <path d="M9.6 10.2a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  building: (
    <>
      <path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20" />
      <path d="M15 10h3.5A1.5 1.5 0 0 1 20 11.5V20" />
      <path d="M3 20h18M8 8h4M8 12h4M8 16h4" />
    </>
  ),
  "chevron-down": <path d="M6.5 9.5 12 15l5.5-5.5" />,
  upload: (
    <>
      <path d="M12 15.5V4.5" />
      <path d="M7.6 8.9 12 4.5l4.4 4.4" />
      <path d="M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.8A.8.8 0 0 1 10.3 4h3.4a.8.8 0 0 1 .8.8V7" />
      <path d="M6.5 7l.9 12.2a.8.8 0 0 0 .8.8h7.6a.8.8 0 0 0 .8-.8L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8" />
    </>
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.6" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.9" r="1" fill="currentColor" stroke="none" />
    </>
  ),
};

export function AdminIcon({ name, size = 16 }: { name: AdminIconName; size?: number }) {
  return (
    <svg
      className="admin-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

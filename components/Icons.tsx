/** Small status icons in the text colour; a status is never told by colour alone. */
const svg = (children: React.ReactNode, strokeWidth = 2.2) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Icon = {
  alert: svg(
    <>
      <path d="M12 8v5M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </>,
  ),
  stop: svg(
    <>
      <path d="M8 8l8 8M16 8l-8 8" />
      <circle cx="12" cy="12" r="9" />
    </>,
  ),
  info: svg(
    <>
      <path d="M12 11v6M12 7h.01" />
      <circle cx="12" cy="12" r="9" />
    </>,
  ),
  check: svg(<path d="M5 12l5 5 9-10" />, 2.4),
  up: svg(<path d="M12 19V5M6 11l6-6 6 6" />),
  down: svg(<path d="M12 5v14M6 13l6 6 6-6" />),
  external: svg(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />, 2),
};

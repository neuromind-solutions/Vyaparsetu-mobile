// Common SVG wrapper that safely merges style/className and sets defaults
const SvgIcon = ({ className, style, children, ...props }) => {
  const mergedStyle = {
    width: '1.1em', // slightly larger than 1em for better visual balance
    height: '1.1em',
    display: 'inline-block',
    verticalAlign: 'middle',
    flexShrink: 0,
    ...style
  };
  return (
    <svg
      className={`icon ${className || ''}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={mergedStyle}
      {...props}
    >
      {children}
    </svg>
  );
};

export const SearchIcon = (props) => (
  <SvgIcon {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </SvgIcon>
);

export const AlertIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </SvgIcon>
);

export const CheckIcon = (props) => (
  <SvgIcon {...props}>
    <polyline points="20 6 9 17 4 12" />
  </SvgIcon>
);

export const SaveIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </SvgIcon>
);

export const EditIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </SvgIcon>
);

export const TrashIcon = (props) => (
  <SvgIcon {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </SvgIcon>
);

export const PrintIcon = (props) => (
  <SvgIcon {...props}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </SvgIcon>
);

export const EyeIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </SvgIcon>
);

export const PhoneIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </SvgIcon>
);

export const MapPinIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </SvgIcon>
);

export const CalendarIcon = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </SvgIcon>
);

export const HistoryIcon = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </SvgIcon>
);

export const CloudIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </SvgIcon>
);

export const GlobeIcon = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </SvgIcon>
);

export const PlugIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M17 5H7a1 1 0 0 0-1 1v6a5 5 0 0 0 10 0V6a1 1 0 0 0-1-1z" />
    <path d="M12 17v4" />
    <path d="M8 2v3" />
    <path d="M16 2v3" />
  </SvgIcon>
);

export const KeyIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </SvgIcon>
);

export const UsersIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </SvgIcon>
);

export const LeafIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 9.8a7 7 0 0 1-9 8.2z" />
    <path d="M9 22v-4" />
  </SvgIcon>
);

export const ReceiptIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="8" y1="16" x2="14" y2="16" />
  </SvgIcon>
);

export const ChartIcon = (props) => (
  <SvgIcon {...props}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </SvgIcon>
);

export const FolderIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </SvgIcon>
);

export const CogIcon = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </SvgIcon>
);

export const BuildingIcon = (props) => (
  <SvgIcon {...props}>
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <line x1="9" y1="22" x2="9" y2="16" />
    <path d="M9 16h6v6" />
    <line x1="8" y1="6" x2="8.01" y2="6" />
    <line x1="16" y1="6" x2="16.01" y2="6" />
    <line x1="8" y1="10" x2="8.01" y2="10" />
    <line x1="16" y1="10" x2="16.01" y2="10" />
    <line x1="12" y1="6" x2="12.01" y2="6" />
    <line x1="12" y1="10" x2="12.01" y2="10" />
  </SvgIcon>
);

export const FileIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </SvgIcon>
);

export const UploadIcon = (props) => (
  <SvgIcon {...props}>
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </SvgIcon>
);

export const SendIcon = (props) => (
  <SvgIcon {...props}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </SvgIcon>
);

export const CopyIcon = (props) => (
  <SvgIcon {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </SvgIcon>
);

export const DownloadIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </SvgIcon>
);

export const FileSpreadsheetIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h8" />
    <path d="M8 17h8" />
    <path d="M12 9v8" />
  </SvgIcon>
);

export const RefreshIcon = (props) => (
  <SvgIcon {...props}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </SvgIcon>
);


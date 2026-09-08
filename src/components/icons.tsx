import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const sharedProps: IconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function HandIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M7.4 11V6.7a1.6 1.6 0 0 1 3.2 0V10" />
      <path d="M10.6 10V5.4a1.6 1.6 0 1 1 3.2 0V10" />
      <path d="M13.8 10V6.4a1.6 1.6 0 1 1 3.2 0v4.8" />
      <path d="M17 10a1.6 1.6 0 1 1 3.2 0v3.4c0 4.7-2.8 7.3-7.2 7.3h-.7c-2.2 0-3.7-.8-5.1-2.4l-3.1-3.7a1.7 1.7 0 0 1 2.5-2.3l.8.7" />
    </svg>
  );
}

export function SelectIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="m5 3 12.2 10.3-6.3 1.1-3.2 5.3L5 3Z" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v10.5L15 21H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" />
      <path d="M15 21v-4a1.5 1.5 0 0 1 1.5-1.5h4" />
    </svg>
  );
}

export function TextIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M5 5V3.5h14V5M12 3.5V20M8.5 20h7" />
    </svg>
  );
}

export function ConnectorIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18.5" cy="6.5" r="2.5" />
      <path d="M7.5 16 16.5 8" />
      <path d="m13.8 7.8 3-.2-.2 3" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M4.9 8.2A8 8 0 1 1 4 12" />
      <path d="M4 4v4.5h4.5" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M9 7 4 12l5 5" />
      <path d="M5 12h8.5a5.5 5.5 0 0 1 5.5 5.5V19" />
    </svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="m15 7 5 5-5 5" />
      <path d="M19 12h-8.5A5.5 5.5 0 0 0 5 17.5V19" />
    </svg>
  );
}

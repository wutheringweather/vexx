import type { SVGProps } from 'react'

/**
 * A small hand-drawn icon set on a 24px grid, 1.6 stroke.
 * Inline rather than a dependency: the CSP forbids remote fonts and this is
 * a dozen paths.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconOverview = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="9" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" />
    <rect x="13.5" y="12" width="7.5" height="9" rx="1.6" />
    <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.6" />
  </Icon>
)

export const IconAgent = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="17" height="12" rx="3.5" />
    <path d="M12 7V3.5M9.5 12.5v1.5M14.5 12.5v1.5" />
    <circle cx="12" cy="2.6" r="1.1" />
  </Icon>
)

export const IconMission = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <circle cx="12" cy="12" r="4.4" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Icon>
)

export const IconApproval = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 2.8 4.2 6v6c0 4.6 3.2 8.2 7.8 9.2 4.6-1 7.8-4.6 7.8-9.2V6L12 2.8Z" />
    <path d="m9 12 2.2 2.2L15.4 10" />
  </Icon>
)

export const IconWallet = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3.5 8.2c0-1.5 1.2-2.7 2.7-2.7h11.6c1.5 0 2.7 1.2 2.7 2.7v7.6c0 1.5-1.2 2.7-2.7 2.7H6.2a2.7 2.7 0 0 1-2.7-2.7V8.2Z" />
    <path d="M3.5 10.5h5.2a1.5 1.5 0 0 1 0 3H3.5" />
  </Icon>
)

export const IconGuard = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="4.2" y="10.4" width="15.6" height="10.4" rx="2.6" />
    <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
    <path d="M12 14.8v2" />
  </Icon>
)

export const IconMemory = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 4.2a3.4 3.4 0 0 0-3.4 3.4v.3A3.2 3.2 0 0 0 6 11a3.2 3.2 0 0 0 1.5 2.7v.4A3.4 3.4 0 0 0 12 17.5" />
    <path d="M12 4.2a3.4 3.4 0 0 1 3.4 3.4v.3A3.2 3.2 0 0 1 18 11a3.2 3.2 0 0 1-1.5 2.7v.4A3.4 3.4 0 0 1 12 17.5" />
    <path d="M12 4.2v15.6" />
  </Icon>
)

export const IconAudit = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 3.5h8.4L19 8.1V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5Z" />
    <path d="M14 3.6V8h4.6M8.6 13h6.8M8.6 16.6h4.4" />
  </Icon>
)

export const IconSettings = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.6a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.98h-.17a1.9 1.9 0 1 1 0-3.79h.09A1.6 1.6 0 0 0 5.2 8.9a1.6 1.6 0 0 0-.32-1.78l-.06-.05a1.9 1.9 0 1 1 2.7-2.7l.05.06a1.6 1.6 0 0 0 1.78.32h.08a1.6 1.6 0 0 0 .97-1.47v-.17a1.9 1.9 0 0 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.78-.32l.05-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.47.97Z" />
  </Icon>
)

export const IconCheck = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
)

export const IconX = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const IconAlert = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.6v5.2M12 16.2v.1" />
  </Icon>
)

export const IconInfo = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.2M12 7.8v.1" />
  </Icon>
)

export const IconLock = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="4.8" y="10.6" width="14.4" height="9.6" rx="2.4" />
    <path d="M8.4 10.6V7.8a3.6 3.6 0 1 1 7.2 0v2.8" />
  </Icon>
)

export const IconUnlock = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="4.8" y="10.6" width="14.4" height="9.6" rx="2.4" />
    <path d="M8.4 10.6V7.8a3.6 3.6 0 0 1 6.9-1.3" />
  </Icon>
)

export const IconRefresh = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M20 11.5a8 8 0 1 0-.9 4.5" />
    <path d="M20 5.5v6h-6" />
  </Icon>
)

export const IconSend = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M20.5 3.5 10.8 13.2M20.5 3.5l-6.3 17-3.4-7.3-7.3-3.4 17-6.3Z" />
  </Icon>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </Icon>
)

export const IconPlay = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M7.5 5.6 18.4 12 7.5 18.4V5.6Z" />
  </Icon>
)

export const IconExternal = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M13.5 4.5H19.5V10.5M19.5 4.5 11 13" />
    <path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7.5A1.5 1.5 0 0 1 5.5 6h4" />
  </Icon>
)

export const IconCopy = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2.2" />
    <path d="M15 6.2V5.5A2 2 0 0 0 13 3.5H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h.7" />
  </Icon>
)

export const IconSun = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6" />
  </Icon>
)

export const IconMoon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4 8.4 8.4 0 1 0 20 14.4Z" />
  </Icon>
)

export const IconInbox = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
    <path d="M5.6 5.5h12.8l2.1 8v5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-5l2.1-8Z" />
  </Icon>
)

/**
 * A brand glyph rather than a drawn icon, so it fills instead of strokes.
 * Named IconBrandX because IconX above is the close cross.
 */
export const IconBrandX = (p: IconProps): React.JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
  </Icon>
)

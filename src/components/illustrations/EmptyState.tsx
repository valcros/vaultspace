/**
 * Empty state illustration components.
 * Simple, inline SVGs — no external dependencies.
 */

interface IllustrationProps {
  className?: string;
}

export function EmptyDocuments({ className = 'h-28 w-28' }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="25"
        y="15"
        width="70"
        height="90"
        rx="6"
        fill="#EFF6FF"
        stroke="#BFDBFE"
        strokeWidth="2"
      />
      <rect x="35" y="35" width="40" height="4" rx="2" fill="#93C5FD" />
      <rect x="35" y="45" width="30" height="4" rx="2" fill="#BFDBFE" />
      <rect x="35" y="55" width="35" height="4" rx="2" fill="#BFDBFE" />
      <rect x="35" y="65" width="25" height="4" rx="2" fill="#DBEAFE" />
      <path d="M55 80 L65 90 L55 90 Z" fill="#3B82F6" opacity="0.3" />
      <circle cx="85" cy="85" r="18" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="2" />
      <path
        d="M80 85 L85 80 L90 85 M85 80 V92"
        stroke="#3B82F6"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyRooms({ className = 'h-28 w-28' }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M20 45 L60 25 L100 45 V95 H20 V45Z"
        fill="#FEF3C7"
        stroke="#FCD34D"
        strokeWidth="2"
      />
      <rect
        x="30"
        y="50"
        width="60"
        height="45"
        rx="2"
        fill="#FFFBEB"
        stroke="#FDE68A"
        strokeWidth="1.5"
      />
      <rect x="42" y="60" width="36" height="4" rx="2" fill="#FCD34D" />
      <rect x="42" y="68" width="28" height="4" rx="2" fill="#FDE68A" />
      <rect x="42" y="76" width="20" height="4" rx="2" fill="#FEF3C7" />
      <circle cx="88" cy="35" r="14" fill="#FDE68A" stroke="#FCD34D" strokeWidth="2" />
      <path d="M84 35 H92 M88 31 V39" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyMembers({ className = 'h-28 w-28' }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="45" cy="45" r="16" fill="#F3E8FF" stroke="#D8B4FE" strokeWidth="2" />
      <circle cx="45" cy="40" r="6" fill="#D8B4FE" />
      <path
        d="M33 55 C33 49 39 45 45 45 C51 45 57 49 57 55"
        stroke="#D8B4FE"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="75" cy="50" r="14" fill="#EDE9FE" stroke="#C4B5FD" strokeWidth="2" />
      <circle cx="75" cy="45.5" r="5" fill="#C4B5FD" />
      <path
        d="M65 58 C65 53 70 50 75 50 C80 50 85 53 85 58"
        stroke="#C4B5FD"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="90" cy="80" r="12" fill="#EDE9FE" stroke="#C4B5FD" strokeWidth="1.5" />
      <path d="M86 80 H94 M90 76 V84" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyActivity({ className = 'h-28 w-28' }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="30"
        y="20"
        width="60"
        height="80"
        rx="6"
        fill="#F0FDF4"
        stroke="#BBF7D0"
        strokeWidth="2"
      />
      <circle cx="45" cy="40" r="4" fill="#86EFAC" />
      <rect x="55" y="38" width="25" height="4" rx="2" fill="#BBF7D0" />
      <circle cx="45" cy="55" r="4" fill="#4ADE80" />
      <rect x="55" y="53" width="20" height="4" rx="2" fill="#BBF7D0" />
      <circle cx="45" cy="70" r="4" fill="#22C55E" />
      <rect x="55" y="68" width="28" height="4" rx="2" fill="#BBF7D0" />
      <circle cx="45" cy="85" r="4" fill="#BBF7D0" />
      <rect x="55" y="83" width="15" height="4" rx="2" fill="#DCFCE7" />
      <line x1="45" y1="44" x2="45" y2="51" stroke="#BBF7D0" strokeWidth="1.5" />
      <line x1="45" y1="59" x2="45" y2="66" stroke="#BBF7D0" strokeWidth="1.5" />
      <line x1="45" y1="74" x2="45" y2="81" stroke="#BBF7D0" strokeWidth="1.5" />
    </svg>
  );
}

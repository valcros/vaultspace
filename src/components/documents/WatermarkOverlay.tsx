'use client';

/**
 * WatermarkOverlay
 *
 * Renders a dynamic watermark over document preview content.
 * Applied at render time — not baked into stored files.
 *
 * Watermark text is generated from a template with placeholders:
 *   {viewer_email}, {viewer_name}, {timestamp}, {ip}, {room_name}
 *
 * Default template: "{viewer_email} | {timestamp}"
 */

interface WatermarkOverlayProps {
  /** Watermark template string with {placeholder} tokens */
  template?: string;
  /** Viewer's email address */
  viewerEmail?: string;
  /** Viewer's display name */
  viewerName?: string;
  /** Viewer's IP address */
  viewerIp?: string;
  /** Room name */
  roomName?: string;
  /** Opacity (0-1, default 0.08) */
  opacity?: number;
  /** Font size in pixels (default 16) */
  fontSize?: number;
  /** Rotation angle in degrees (default -30) */
  angle?: number;
  /** Text color (default #888888) */
  color?: string;
}

const DEFAULT_TEMPLATE = '{viewer_email} | {timestamp}';

function resolveTemplate(template: string, props: WatermarkOverlayProps): string {
  const now = new Date();
  return template
    .replace(/\{viewer_email\}/g, props.viewerEmail ?? '')
    .replace(/\{viewer_name\}/g, props.viewerName ?? '')
    .replace(/\{viewer_ip\}/g, props.viewerIp ?? '')
    .replace(/\{room_name\}/g, props.roomName ?? '')
    .replace(/\{timestamp\}/g, now.toLocaleString())
    .replace(/\{date\}/g, now.toLocaleDateString())
    .trim();
}

export function WatermarkOverlay(props: WatermarkOverlayProps) {
  const {
    template = DEFAULT_TEMPLATE,
    opacity = 0.12,
    fontSize = 16,
    angle = -30,
    color = '#888888',
  } = props;

  const watermarkText = resolveTemplate(template, props);

  if (!watermarkText) {
    return null;
  }

  // Generate a grid of repeating watermark text
  // Using CSS to tile the watermark across the entire overlay
  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 select-none overflow-hidden"
      aria-hidden="true"
      data-testid="watermark-overlay"
    >
      <div
        className="absolute inset-0"
        style={{
          // Position a large rotated grid that covers the entire container
          display: 'flex',
          flexWrap: 'wrap',
          alignContent: 'flex-start',
          gap: `${fontSize * 4}px ${fontSize * 2}px`,
          padding: `${fontSize * 2}px`,
          transform: `rotate(${angle}deg)`,
          transformOrigin: 'center center',
          // Expand beyond bounds to cover corners when rotated
          width: '200%',
          height: '200%',
          top: '-50%',
          left: '-50%',
        }}
      >
        {Array.from({ length: 80 }, (_, i) => (
          <span
            key={i}
            style={{
              fontSize: `${fontSize}px`,
              color,
              opacity,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              letterSpacing: '0.05em',
            }}
          >
            {watermarkText}
          </span>
        ))}
      </div>
    </div>
  );
}

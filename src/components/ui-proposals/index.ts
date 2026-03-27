/**
 * UI Modernization Proposal Components
 *
 * These are PROTOTYPE components for stakeholder review.
 * They demonstrate alternative navigation patterns for VaultSpace.
 *
 * Options:
 * - FloatingDock: macOS-style dock navigation
 * - EnhancedCommandMenu: Spotlight-style ⌘K navigation
 * - IconRail: Thin icon sidebar (VSCode/Figma style)
 * - DemoLayout: Full layout demonstrating Option D
 *
 * To preview: Visit /demo in the browser
 */

export { FloatingDock } from './floating-dock';
export { EnhancedCommandMenu, useCommandMenu } from './command-menu';
export { IconRail } from './icon-rail';
export { DemoLayout, DemoContent } from './demo-layout';
export { cn } from './utils';

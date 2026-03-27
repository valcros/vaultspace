'use client';

/**
 * UI Modernization Demo Landing Page
 *
 * This page provides links to all 4 navigation options for stakeholder review.
 * Each option can be previewed independently.
 */

import Link from 'next/link';
import {
  Monitor,
  Command,
  LayoutGrid,
  PanelLeft,
  ArrowRight,
  Star,
  ExternalLink,
} from 'lucide-react';

const options = [
  {
    id: 'option-d',
    name: 'Option D: Hybrid Rail + Command',
    description: 'Thin icon rail (48px) with ⌘K command palette. Best of both worlds - familiar to VSCode/Figma users.',
    icon: PanelLeft,
    recommended: true,
    status: 'ready',
    features: ['Icon rail navigation', '⌘K command palette', 'Tooltips on hover', 'Active state indicators'],
  },
  {
    id: 'option-a',
    name: 'Option A: Floating Dock',
    description: 'macOS-style floating dock at the bottom with magnification effect. Maximum content area.',
    icon: Monitor,
    recommended: false,
    status: 'ready',
    features: ['Magnification on hover', 'Floating position', 'Glassmorphism effect', 'Badge notifications'],
  },
  {
    id: 'option-b',
    name: 'Option B: Command Palette Primary',
    description: 'Minimal chrome with ⌘K as the primary navigation method. Power-user focused.',
    icon: Command,
    recommended: false,
    status: 'ready',
    features: ['Search everything', 'Keyboard shortcuts', 'Recent items', 'Quick actions'],
  },
  {
    id: 'option-c',
    name: 'Option C: Widget Dashboard',
    description: 'Customizable widget-based dashboard with contextual slide-in panels.',
    icon: LayoutGrid,
    recommended: false,
    status: 'planned',
    features: ['Draggable widgets', 'Personalized layout', 'Stats at a glance', 'Slide-in panels'],
  },
];

export default function DemoLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 font-bold text-white shadow-lg">
              V
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                VaultSpace UI Modernization
              </h1>
              <p className="text-sm text-gray-500">
                Interactive prototype demos for stakeholder review
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Intro */}
        <div className="mb-12 rounded-2xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-900 dark:bg-blue-950/50">
          <h2 className="mb-2 text-lg font-semibold text-blue-900 dark:text-blue-100">
            About This Demo
          </h2>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            These prototypes demonstrate four different navigation approaches to replace
            the current sidebar-based interface. Each option prioritizes content area
            while providing intuitive navigation. Click any option below to see it in action.
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
            <span className="rounded bg-blue-200 px-2 py-1 dark:bg-blue-900">Pro tip</span>
            <span>Press ⌘K (Mac) or Ctrl+K (Windows) in any demo to open the command palette</span>
          </div>
        </div>

        {/* Options Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {options.map((option) => (
            <Link
              key={option.id}
              href={option.status === 'ready' ? `/demo/${option.id}` : '#'}
              className={`group relative rounded-2xl border bg-white p-6 transition-all duration-200 dark:bg-gray-900 ${
                option.status === 'ready'
                  ? 'border-gray-200 hover:border-blue-300 hover:shadow-xl dark:border-gray-800 dark:hover:border-blue-700'
                  : 'cursor-not-allowed border-gray-100 opacity-60 dark:border-gray-900'
              }`}
            >
              {/* Recommended Badge */}
              {option.recommended && (
                <div className="absolute -top-3 right-4 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                  <Star className="h-3 w-3" />
                  Recommended
                </div>
              )}

              {/* Header */}
              <div className="mb-4 flex items-start gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                  option.recommended
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  <option.icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                    {option.name}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {option.description}
                  </p>
                </div>
              </div>

              {/* Features */}
              <ul className="mb-4 grid grid-cols-2 gap-2">
                {option.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2 text-xs text-gray-500"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                    {feature}
                  </li>
                ))}
              </ul>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                  option.status === 'ready'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  {option.status === 'ready' ? 'Ready to preview' : 'Coming soon'}
                </span>
                {option.status === 'ready' && (
                  <span className="flex items-center gap-1 text-sm font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-blue-400">
                    View demo
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* Documentation Link */}
        <div className="mt-12 text-center">
          <p className="mb-4 text-sm text-gray-500">
            Full proposal with mockups, rationale, and implementation details
          </p>
          <a
            href="https://github.com/valcros/vaultspace/blob/main/docs/UI_MODERNIZATION_PROPOSAL.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ExternalLink className="h-4 w-4" />
            View Full Proposal on GitHub
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white/50 dark:border-gray-800 dark:bg-gray-950/50">
        <div className="mx-auto max-w-5xl px-6 py-4 text-center text-xs text-gray-400">
          VaultSpace UI Modernization Prototype • Created for Stakeholder Review
        </div>
      </footer>
    </div>
  );
}

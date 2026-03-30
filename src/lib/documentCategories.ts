/**
 * Document category labels, colors, and utilities.
 *
 * Maps the Prisma DocumentCategory enum to human-readable labels
 * and display colors for badges and filters.
 */

export const DOCUMENT_CATEGORIES = {
  FINANCIAL_STATEMENTS: {
    label: 'Financial Statements',
    color: 'text-green-700 bg-green-50 border-green-200',
  },
  TAX_RETURNS: { label: 'Tax Returns', color: 'text-green-700 bg-green-50 border-green-200' },
  CONTRACTS_AGREEMENTS: { label: 'Contracts', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  CORPORATE_DOCUMENTS: {
    label: 'Corporate',
    color: 'text-neutral-700 bg-neutral-50 border-neutral-200',
  },
  INTELLECTUAL_PROPERTY: { label: 'IP', color: 'text-purple-700 bg-purple-50 border-purple-200' },
  PITCH_DECK: { label: 'Pitch Deck', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  PROFORMA_PROJECTIONS: { label: 'Proforma', color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  DUE_DILIGENCE: { label: 'Due Diligence', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  INSURANCE: { label: 'Insurance', color: 'text-red-700 bg-red-50 border-red-200' },
  COMPLIANCE: { label: 'Compliance', color: 'text-rose-700 bg-rose-50 border-rose-200' },
  TECHNICAL_DOCS: { label: 'Technical', color: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  HR_EMPLOYMENT: { label: 'HR', color: 'text-pink-700 bg-pink-50 border-pink-200' },
  REAL_ESTATE_LEASE: { label: 'Real Estate', color: 'text-teal-700 bg-teal-50 border-teal-200' },
  OTHER: { label: 'Other', color: 'text-neutral-600 bg-neutral-50 border-neutral-200' },
} as const;

export type DocumentCategoryKey = keyof typeof DOCUMENT_CATEGORIES;

export function getCategoryLabel(category: string | null | undefined): string | null {
  if (!category) {
    return null;
  }
  return DOCUMENT_CATEGORIES[category as DocumentCategoryKey]?.label ?? category;
}

export function getCategoryColor(category: string | null | undefined): string {
  if (!category) {
    return '';
  }
  return (
    DOCUMENT_CATEGORIES[category as DocumentCategoryKey]?.color ??
    'text-neutral-600 bg-neutral-50 border-neutral-200'
  );
}

/** All categories as an array for dropdowns and filters */
export const CATEGORY_OPTIONS = Object.entries(DOCUMENT_CATEGORIES).map(([value, { label }]) => ({
  value,
  label,
}));

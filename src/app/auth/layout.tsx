import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authentication - VaultSpace',
  description: 'Sign in to your VaultSpace account',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-neutral-950">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-6xl items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="hidden rounded-2xl bg-slate-900 p-10 text-white shadow-md lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold text-white shadow-md">
              V
            </div>
            <span className="text-2xl font-bold tracking-tight">VaultSpace</span>
          </div>
          <p className="mt-10 text-xs font-medium uppercase tracking-wide text-sky-200">
            Secure Virtual Data Rooms
          </p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold tracking-tight">
            Move sensitive deals, diligence, and investor workflows through one secure workspace.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-slate-100">
            VaultSpace keeps teams aligned across rooms, documents, questions, and audit activity
            without forcing users through a generic file portal.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              [
                'Secure access',
                'Controlled room visibility, signed previews, and session-backed auth.',
              ],
              [
                'Investor ready',
                'Designed for diligence, fundraising, board work, and external review.',
              ],
              [
                'Operational clarity',
                'Rooms, messages, questions, and activity stay in one shared flow.',
              ],
            ].map(([title, body]) => (
              <div key={title} className="border-white/12 rounded-2xl border bg-white/10 p-4">
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-2 text-xs leading-5 text-slate-100">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full max-w-md justify-self-center lg:max-w-lg">
          <div className="mb-8 flex justify-center lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-600 text-xl font-bold text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.7)]">
                V
              </div>
              <span className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
                VaultSpace
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 sm:p-10">
            {children}
          </div>

          <div className="mt-8 text-center text-sm text-slate-600 dark:text-slate-300">
            <p>Secure Virtual Data Room Platform</p>
          </div>
        </div>
      </div>
    </div>
  );
}

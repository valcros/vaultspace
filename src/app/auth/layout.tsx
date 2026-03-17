import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authentication - VaultSpace',
  description: 'Sign in to your VaultSpace account',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-xl font-bold text-white">
              V
            </div>
            <span className="text-2xl font-bold text-neutral-900">VaultSpace</span>
          </div>
        </div>

        {/* Auth Card */}
        <div className="rounded-lg border border-neutral-200 bg-white p-8 shadow-md">
          {children}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-neutral-500">
          <p>Secure Virtual Data Room Platform</p>
        </div>
      </div>
    </div>
  );
}

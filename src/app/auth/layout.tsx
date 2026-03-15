import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authentication - VaultSpace',
  description: 'Sign in to your VaultSpace account',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white font-bold text-xl">
              V
            </div>
            <span className="text-2xl font-bold text-neutral-900">VaultSpace</span>
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-lg shadow-md border border-neutral-200 p-8">
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

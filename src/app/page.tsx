import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-primary mb-4 text-4xl font-bold">VaultSpace</h1>
        <p className="text-muted-foreground mb-8 text-lg">Secure Virtual Data Room Platform</p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/auth/login"
            className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/auth/register"
            className="rounded-md border border-input bg-background px-6 py-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Create Account
          </Link>
        </div>
      </div>
    </main>
  );
}

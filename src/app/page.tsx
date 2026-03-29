import Link from 'next/link';
import { Shield, FileText, Users, Lock, BarChart3, Globe } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-neutral-50">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE4YzAtOS45NC04LjA2LTE4LTE4LTE4UzAgOC4wNiAwIDE4czguMDYgMTggMTggMTggMTgtOC4wNiAxOC0xOHoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-50" />
        <div className="relative mx-auto max-w-5xl px-6 py-24 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-primary-100">
            <Shield className="h-4 w-4" />
            Enterprise-grade security
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Secure Virtual
            <br />
            Data Rooms
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-primary-100">
            Share confidential documents with investors, partners, and advisors. Full control over
            who sees what, when, and how.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/auth/register"
              className="rounded-xl bg-white px-8 py-3 text-sm font-semibold text-primary-700 shadow-lg transition-all hover:bg-primary-50 hover:shadow-xl"
            >
              Get Started Free
            </Link>
            <Link
              href="/auth/login"
              className="rounded-xl border border-white/30 px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-white/10"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-2 text-center text-2xl font-bold text-neutral-900">
          Everything you need for secure document sharing
        </h2>
        <p className="mb-12 text-center text-neutral-500">
          Purpose-built for M&amp;A, fundraising, board reporting, and compliance
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Lock,
              title: 'Granular Permissions',
              desc: 'Control access at the room, folder, and document level with viewer-specific permissions.',
              color: 'text-primary-600 bg-primary-50',
            },
            {
              icon: FileText,
              title: 'Document Preview',
              desc: 'View PDFs, Office docs, images, and 20+ file types directly in the browser.',
              color: 'text-green-600 bg-green-50',
            },
            {
              icon: Users,
              title: 'Secure Share Links',
              desc: 'Share with external parties via time-limited, password-protected links.',
              color: 'text-purple-600 bg-purple-50',
            },
            {
              icon: Shield,
              title: 'Watermarks & NDA',
              desc: 'Dynamic watermarks with viewer identity. Require NDA acceptance before access.',
              color: 'text-amber-600 bg-amber-50',
            },
            {
              icon: BarChart3,
              title: 'Activity Analytics',
              desc: 'Track who viewed what, when, and for how long. Full audit trail for compliance.',
              color: 'text-red-500 bg-red-50',
            },
            {
              icon: Globe,
              title: 'Self-Hosted',
              desc: 'Deploy on your own Azure infrastructure. Your data never leaves your control.',
              color: 'text-cyan-600 bg-cyan-50',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border bg-white p-5 transition-shadow hover:shadow-md"
            >
              <div className={`mb-3 inline-flex rounded-lg p-2.5 ${feature.color}`}>
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-1 font-semibold text-neutral-900">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-neutral-500">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="border-t bg-white py-12">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h2 className="mb-3 text-xl font-bold text-neutral-900">
            Ready to secure your deal flow?
          </h2>
          <p className="mb-6 text-neutral-500">
            Create your first data room in under a minute. No credit card required.
          </p>
          <Link
            href="/auth/register"
            className="inline-flex rounded-xl bg-primary-600 px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-700 hover:shadow-md"
          >
            Create Free Account
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t py-6">
        <div className="mx-auto max-w-5xl px-6 text-center text-sm text-neutral-400">
          VaultSpace &mdash; Open-source secure virtual data room platform. AGPLv3 licensed.
        </div>
      </div>
    </main>
  );
}

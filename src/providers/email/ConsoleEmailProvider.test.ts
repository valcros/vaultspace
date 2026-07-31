import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleEmailProvider } from './ConsoleEmailProvider';

describe('ConsoleEmailProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never writes a sensitive provider message identifier or body to the console', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      lines.push(values.map(String).join(' '));
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_722_400_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const provider = new ConsoleEmailProvider();
    const bodySentinel = 'secret-reset-token-sentinel';
    const result = await provider.sendEmail({
      to: 'user@example.com',
      subject: 'Reset your password',
      html: `<p>${bodySentinel}</p>`,
      text: bodySentinel,
      sensitiveContent: true,
    });

    const output = lines.join('\n');
    expect(result.messageId).toMatch(/^console-/);
    expect(output).toContain('Message ID: [REDACTED]');
    expect(output).toContain('Body: [REDACTED SENSITIVE CONTENT]');
    expect(output).not.toContain(result.messageId);
    expect(output).not.toContain(bodySentinel);
  });
});

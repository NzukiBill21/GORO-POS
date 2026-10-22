/**
 * Verify Gmail SMTP credentials (no email sent to employees).
 * Usage: npx tsx scripts/smtp-verify.ts
 */
import { loadShopEnvironment } from '../server/lib/loadEnv.js';
import { verifySmtpConnection, isSmtpConfigured } from '../server/lib/mail.js';

loadShopEnvironment();

async function main() {
  if (!isSmtpConfigured()) {
    console.error('SMTP_USER and SMTP_PASS are not set in .env');
    process.exit(1);
  }
  const result = await verifySmtpConnection();
  if (result.ok) {
    console.log('SMTP connection OK (STARTTLS / credentials accepted).');
    return;
  }
  console.error('SMTP verification failed:', result.error);
  process.exit(1);
}

main();

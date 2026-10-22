import { processSubscriptionLifecycle } from '../services/subscriptionLifecycleService.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly — lifecycle checks day boundaries

async function runBillingJobs() {
  if (running) return;
  running = true;
  try {
    const result = await processSubscriptionLifecycle();
    if (result.processed > 0) {
      console.log(`[billing-scheduler] Processed ${result.processed} lifecycle action(s)`);
    }
  } catch (err) {
    console.error('[billing-scheduler] Error:', err);
  } finally {
    running = false;
  }
}

/** Start automated billing lifecycle jobs (renewal reminders, grace, suspension, auto-renew STK) */
export function startBillingScheduler() {
  const enabled = process.env.BILLING_CRON_ENABLED !== 'false';
  if (!enabled) {
    console.log('[billing-scheduler] Disabled (BILLING_CRON_ENABLED=false)');
    return;
  }

  const intervalMs = parseInt(process.env.BILLING_CRON_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS), 10);
  console.log(`[billing-scheduler] Starting — runs every ${Math.round(intervalMs / 60000)} minute(s)`);

  // Run once shortly after startup
  setTimeout(() => void runBillingJobs(), 5000);

  intervalHandle = setInterval(() => void runBillingJobs(), intervalMs);
}

export function stopBillingScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export { runBillingJobs };

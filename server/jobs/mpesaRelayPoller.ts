import crypto from 'crypto';
import { processPosStkCallback } from '../services/pos/posMpesaStkService.js';

let timer: ReturnType<typeof setInterval> | null = null;
let backoffMs = 15_000;

function relayConfigured(): boolean {
  return !!(process.env.MPESA_RELAY_URL?.trim() && process.env.MPESA_RELAY_TILL_TOKEN?.trim());
}

function signCursor(cursor: string): string {
  const secret = process.env.MPESA_RELAY_TILL_TOKEN!.trim();
  return crypto.createHmac('sha256', secret).update(cursor).digest('hex');
}

async function pollOnce(): Promise<void> {
  const base = process.env.MPESA_RELAY_URL!.trim().replace(/\/$/, '');
  const token = process.env.MPESA_RELAY_TILL_TOKEN!.trim();
  const cursor = process.env.MPESA_RELAY_CURSOR?.trim() ?? '0';

  const res = await fetch(`${base}/v1/events?cursor=${encodeURIComponent(cursor)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Relay-Signature': signCursor(cursor),
    },
  });
  if (!res.ok) {
    throw new Error(`Relay poll failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    events: Array<{ id: string; payload: unknown; checkoutRequestId?: string }>;
    nextCursor: string;
  };

  const ackIds: string[] = [];
  for (const ev of data.events ?? []) {
    const body = ev.payload as Parameters<typeof processPosStkCallback>[0];
    const result = await processPosStkCallback(body);
    if (result.processed || result.duplicate) {
      ackIds.push(ev.id);
    }
  }

  if (data.nextCursor) {
    process.env.MPESA_RELAY_CURSOR = data.nextCursor;
  }

  if (ackIds.length > 0) {
    await fetch(`${base}/v1/events/ack`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ackIds }),
    });
  }

  backoffMs = 15_000;
}

export function startMpesaRelayPoller(): void {
  if (!relayConfigured() || timer) return;

  const tick = () => {
    void pollOnce().catch((err) => {
      console.warn('[mpesa-relay]', err instanceof Error ? err.message : err);
      backoffMs = Math.min(backoffMs * 2, 120_000);
    });
  };

  tick();
  timer = setInterval(tick, backoffMs);
  console.log('[mpesa-relay] Outbound callback poller started');
}

export function stopMpesaRelayPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

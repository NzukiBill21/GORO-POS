/**
 * Narrow M-Pesa STK callback relay — stores events for outbound till polling.
 * Does NOT proxy to shop LAN or execute till commands.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearerToken(req) {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() ?? '';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/v1/mpesa/stk-callback' && request.method === 'POST') {
      const tenant = url.searchParams.get('tenant');
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ ResultCode: 1, ResultDesc: 'Invalid JSON' }, 400);
      }
      const checkoutId = payload?.Body?.stkCallback?.CheckoutRequestID;
      if (!checkoutId) {
        return json({ ResultCode: 0, ResultDesc: 'Accepted' });
      }
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO mpesa_events (id, checkout_request_id, tenant_id, payload) VALUES (?, ?, ?, ?)`
        )
          .bind(id, checkoutId, tenant, JSON.stringify(payload))
          .run();
      } catch (e) {
        if (String(e).includes('UNIQUE')) {
          return json({ ResultCode: 0, ResultDesc: 'Duplicate' });
        }
        throw e;
      }
      return json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (url.pathname === '/v1/events' && request.method === 'GET') {
      const token = bearerToken(request);
      if (!token || token !== env.MPESA_RELAY_TILL_TOKEN) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const cursor = url.searchParams.get('cursor') ?? '0';
      const sig = request.headers.get('X-Relay-Signature') ?? '';
      const expected = await hmacHex(env.MPESA_RELAY_TILL_TOKEN, cursor);
      if (sig !== expected) {
        return json({ error: 'Bad signature' }, 401);
      }

      const rows = await env.DB.prepare(
        `SELECT id, payload, checkout_request_id FROM mpesa_events
         WHERE delivered_at IS NULL AND id > ?
         ORDER BY id ASC LIMIT 20`
      )
        .bind(cursor === '0' ? '' : cursor)
        .all();

      const events = (rows.results ?? []).map((r) => ({
        id: r.id,
        checkoutRequestId: r.checkout_request_id,
        payload: JSON.parse(r.payload),
      }));
      const nextCursor = events.length > 0 ? events[events.length - 1].id : cursor;
      return json({ events, nextCursor });
    }

    if (url.pathname === '/v1/events/ack' && request.method === 'POST') {
      const token = bearerToken(request);
      if (!token || token !== env.MPESA_RELAY_TILL_TOKEN) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const body = await request.json();
      const ids = body?.ids ?? [];
      for (const id of ids) {
        await env.DB.prepare(`UPDATE mpesa_events SET delivered_at = datetime('now') WHERE id = ?`)
          .bind(id)
          .run();
      }
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};

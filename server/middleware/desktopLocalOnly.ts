import type { Request, Response, NextFunction } from 'express';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function clientIp(req: Request): string {
  return req.socket.remoteAddress ?? '';
}

/** Reject non-loopback clients when running as a desktop till (defense in depth). */
export function desktopLocalOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.DESKTOP_MODE !== 'true') return next();
    if (process.env.ALLOW_LAN_BIND === 'true') return next();
    if (LOOPBACK.has(clientIp(req))) return next();
    res.status(403).json({ error: 'This till accepts local connections only' });
  };
}

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';
import { safeErrorLog } from '../lib/safeLog.js';

export function errorHandler(
  err: Error & { type?: string; status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error:
        'Upload is too large (max about 1.5 MB). Use a smaller workbook or remove unused sheets and images.',
    });
  }
  if (err instanceof AppError) {
    const body: { error: string; code?: string } = { error: err.message };
    if (err.code) body.code = err.code;
    return res.status(err.statusCode).json(body);
  }
  safeErrorLog('Error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
}

export type ApiErrorBody = {
  error?: string;
  message?: string;
  errors?: Array<{ rowNumber: number; message: string }>;
  details?: Array<{ path: string; message: string }>;
};

export function formatApiErrorBody(data: ApiErrorBody, status: number): string {
  if (typeof data.error === 'string' && data.error.trim() && data.error !== 'Validation failed') {
    return data.error;
  }
  if (Array.isArray(data.details) && data.details.length > 0) {
    return data.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('. ');
  }
  if (typeof data.message === 'string') {
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0];
      return `${data.message}: row ${first.rowNumber} — ${first.message}`;
    }
    return data.message;
  }
  if (typeof data.error === 'string' && data.error.trim()) return data.error;
  return `HTTP ${status}`;
}

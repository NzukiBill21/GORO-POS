export type ToastVariant = 'success' | 'error';

export type ToastPayload = {
  id: number;
  message: string;
  variant: ToastVariant;
};

const listeners = new Set<(toast: ToastPayload) => void>();
let nextId = 0;

function emit(message: string, variant: ToastVariant) {
  const toast: ToastPayload = { id: ++nextId, message, variant };
  listeners.forEach((l) => l(toast));
}

export function toastSuccess(message: string) {
  emit(message, 'success');
}

export function toastError(message: string) {
  emit(message, 'error');
}

export function subscribeToasts(listener: (toast: ToastPayload) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

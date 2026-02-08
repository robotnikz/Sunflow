import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number; // 0 disables auto-dismiss
  action?: ToastAction;
};

type ToastItem = ToastOptions & {
  id: string;
};

type ToastContextValue = {
  push: (toast: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue>({
  push: () => {
    // no-op (allows using SettingsModal in isolated tests)
  },
});

export const useToast = () => useContext(ToastContext);

const getToastStyles = (type: ToastType) => {
  switch (type) {
    case 'success':
      return {
        border: 'border-emerald-800/50',
        title: 'text-emerald-200',
        icon: <CheckCircle2 size={16} className="text-emerald-400" />,
      };
    case 'warning':
      return {
        border: 'border-yellow-800/50',
        title: 'text-yellow-200',
        icon: <AlertTriangle size={16} className="text-yellow-400" />,
      };
    case 'error':
      return {
        border: 'border-red-800/50',
        title: 'text-red-200',
        icon: <AlertCircle size={16} className="text-red-400" />,
      };
    default:
      return {
        border: 'border-blue-800/50',
        title: 'text-blue-200',
        icon: <Info size={16} className="text-blue-400" />,
      };
  }
};

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (toast: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const durationMs = toast.durationMs ?? (toast.action ? 8000 : 4000);

      const item: ToastItem = {
        id,
        ...toast,
        durationMs,
      };

      setToasts((prev) => [item, ...prev].slice(0, 5));

      if (durationMs > 0) {
        const timer = window.setTimeout(() => remove(id), durationMs);
        timers.current.set(id, timer);
      }
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
};

export const Toaster: React.FC<{ toasts: ToastItem[]; onDismiss: (id: string) => void }> = ({
  toasts,
  onDismiss,
}) => {
  if (!toasts.length) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[200] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      {toasts.map((t) => {
        const styles = getToastStyles(t.type);

        return (
          <div
            key={t.id}
            className={`rounded-xl border ${styles.border} bg-slate-900/95 shadow-lg backdrop-blur px-4 py-3`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{styles.icon}</div>
              <div className="flex-1">
                <div className={`text-sm font-semibold ${styles.title}`}>{t.title || ''}</div>
                <div className="text-sm text-slate-200">{t.message}</div>
                {t.action && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          t.action?.onClick();
                        } finally {
                          onDismiss(t.id);
                        }
                      }}
                      className="text-xs font-bold px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 transition"
                    >
                      {t.action.label}
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 rounded p-1 transition"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

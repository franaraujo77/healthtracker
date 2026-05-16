// Toast functionality will be implemented in a later story using @tamagui/toast.
// Exported as a no-op stub to satisfy existing import contracts.

export function Toast({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function ToastProvider({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function ToastViewport() {
  return null;
}

const noop = () => undefined;

export function useToastController() {
  return {
    show: (_title: string, _options?: Record<string, unknown>) => noop(),
    hide: () => noop(),
  };
}

export function useToastState() {
  return null;
}

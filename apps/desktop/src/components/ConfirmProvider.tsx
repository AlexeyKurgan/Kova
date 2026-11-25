import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import ConfirmModal from "./ConfirmModal";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  details?: string[];
  note?: string;
  onConfirm?: () => Promise<void>;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setRequest({ options, resolve });
      }),
    [],
  );

  const close = (value: boolean) => {
    if (!request) return;
    request.resolve(value);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <ConfirmModal
          title={request.options.title}
          message={request.options.message}
          confirmLabel={request.options.confirmLabel ?? "Подтвердить"}
          danger={request.options.danger}
          details={request.options.details}
          note={request.options.note}
          onCancel={() => close(false)}
          onConfirm={async () => {
            await request.options.onConfirm?.();
            close(true);
          }}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

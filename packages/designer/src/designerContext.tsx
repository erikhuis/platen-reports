'use client';

/**
 * The host seam for the report designer.
 *
 * Everything in this package reaches its host through this context rather than importing the
 * host's own modules. That is what makes the designer shippable at all: a package cannot bring
 * an i18n library, a permission system, an error formatter or a router with it, but it can ask
 * for a translator, a permission flag, an error formatter and two navigation callbacks.
 *
 * A host writes one thin route wrapper that knows about those things, fills this contract and
 * mounts the provider. Nothing below the wrapper knows the host exists.
 */

import {
  createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material';
import type { ReportsApiClient } from '@platen-reports/model';

/**
 * Host translator: the shape a scoped i18n translator returns, so most hosts can pass theirs
 * straight through. The package brings no i18n library of its own.
 */
export type DesignerTranslate = (key: string, values?: Record<string, string | number>) => string;

/** What the built-in confirm renders. The cancel affordance is the dialog's own. */
export interface DesignerConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
}

export interface ReportDesignerContextValue {
  t: DesignerTranslate;
  /** UI locale — used for host-rendered links and (from #2445) the render/preview calls. */
  locale: string;
  /** Whether the caller may change anything. False ⇒ the designer is read-only. */
  canEdit: boolean;
  /** The host's binding of the reporting API port. */
  api: ReportsApiClient;
  /**
   * Where a host keeps its published definition files, shown in the export dialog so an author
   * knows where to commit what they just exported. Omitted ⇒ only the filename is shown, which
   * is the right default: the engine has no opinion about a host's repository layout.
   */
  definitionDirectory?: string;
  /** Formats a thrown value for display. Defaults to `String(e)`. */
  onError?: (e: unknown) => string;
  /** Overrides the built-in MUI confirm; resolve `true` to proceed. */
  confirm?: (options: DesignerConfirmOptions) => Promise<boolean>;
  /** Leave the designer. Omitted ⇒ the back affordance is hidden. */
  onBack?: () => void;
  /** Switch to another report. Omitted ⇒ the report switcher is read-only. */
  onSelectReport?: (key: string) => void;
}

/** The context as consumers see it: `onError` and `confirm` are always resolved. */
export type ReportDesignerRuntime =
  Omit<ReportDesignerContextValue, 'onError' | 'confirm'>
  & Required<Pick<ReportDesignerContextValue, 'onError' | 'confirm'>>;

const ReportDesignerContext = createContext<ReportDesignerRuntime | null>(null);

const defaultOnError = (e: unknown): string => String(e);

interface PendingConfirm {
  options: DesignerConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

export function ReportDesignerProvider({
  t, locale, canEdit, api, definitionDirectory, onError, confirm, onBack, onSelectReport, children,
}: ReportDesignerContextValue & { children: ReactNode }) {
  // The resolver lives in a ref, not in state: settling it from inside a state updater would
  // be a side effect React is free to run twice (StrictMode double-invoke).
  const pendingRef = useRef<PendingConfirm | null>(null);
  // `open` drives the dialog; `shown` drives its text. They are separate so the wording
  // survives MUI's exit transition — clearing both on settle would blank the title, body
  // and confirm label for the ~195ms fade-out.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<DesignerConfirmOptions | null>(null);

  // Built-in confirm — a host that has its own dialog passes `confirm` and this never renders.
  const builtInConfirm = useCallback(
    (options: DesignerConfirmOptions) => new Promise<boolean>((resolve) => {
      pendingRef.current = { options, resolve };
      setShown(options);
      setOpen(true);
    }),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setOpen(false);
  }, []);

  const value = useMemo<ReportDesignerRuntime>(() => ({
    t,
    locale,
    canEdit,
    api,
    definitionDirectory,
    onError: onError ?? defaultOnError,
    confirm: confirm ?? builtInConfirm,
    onBack,
    onSelectReport,
  }), [t, locale, canEdit, api, definitionDirectory, onError, confirm, builtInConfirm, onBack, onSelectReport]);

  return (
    <ReportDesignerContext.Provider value={value}>
      {children}
      {!confirm && (
        <Dialog
          open={open}
          onClose={() => settle(false)}
          data-testid="designer-confirm"
          TransitionProps={{ onExited: () => setShown(null) }}
        >
          <DialogTitle>{shown?.title}</DialogTitle>
          <DialogContent>
            <DialogContentText>{shown?.body}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => settle(false)}>{t('designerConfirmCancel')}</Button>
            <Button onClick={() => settle(true)} color="error" variant="contained" data-testid="designer-confirm-accept">
              {shown?.confirmLabel}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </ReportDesignerContext.Provider>
  );
}

/** The whole host contract. Throws when a designer component is mounted outside the provider. */
export function useReportDesigner(): ReportDesignerRuntime {
  const value = useContext(ReportDesignerContext);
  if (!value) {
    throw new Error('useReportDesigner must be used inside <ReportDesignerProvider>.');
  }
  return value;
}

/** The host translator — the designer's replacement for `useTranslations('Reports')`. */
export function useDesignerT(): DesignerTranslate {
  return useReportDesigner().t;
}

export function onRequestError(...args: unknown[]): void {
  void import('@sentry/nextjs')
    .then((Sentry) => {
      if (!Sentry.isInitialized()) return;
      // Firma estable en @sentry/nextjs v8: (error, request, context) con la
      // captura delegada en captureRequestError.
      const capture = (
        Sentry as unknown as {
          captureRequestError?: (...captureArgs: unknown[]) => void;
        }
      ).captureRequestError;
      if (capture) capture(...args);
    })
    .catch(() => {
      // El reporte no puede romper el render.
    });
}

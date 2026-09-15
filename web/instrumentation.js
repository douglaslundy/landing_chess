export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const cron = await import('node-cron');
  const { runReconciliation } = await import('./lib/reconcile.js');

  let running = false;
  cron.default.schedule('*/10 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await runReconciliation();
    } catch (error) {
      console.error('[instrumentation] scheduled reconciliation failed:', error);
    } finally {
      running = false;
    }
  });
}

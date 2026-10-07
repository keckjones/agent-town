// Fulfillment: pulls real Etsy orders, tracks Printful production and shipping, and escalates problems.
// It never marks an order shipped/delivered/refunded unless the provider says so.
import { etsyReady, config } from '../config.js';
import { db, say, setIntegration } from '../lib/db.js';
import { syncEtsyOrders } from '../lib/etsy.js';
import { syncPrintful } from '../lib/printful.js';

export const handlers = {
  async sync_orders() {
    const out = {};
    if (etsyReady()) {
      const { data: tok } = await db.from('secrets').select('value').eq('id', 'etsy_tokens').maybeSingle();
      if (tok?.value?.refresh) out.etsy = await syncEtsyOrders().catch(async (e) => { await setIntegration('etsy', 'Etsy', 'error', e.message.slice(0, 200), null, 'etsy'); return { error: e.message }; });
    }
    if (config.printful.token) out.printful = await syncPrintful();

    // Physical orders that sit too long without shipping become exceptions.
    const stale = new Date(Date.now() - 5 * 864e5).toISOString();
    const { data: late } = await db.from('orders').select('id, external_id, status, data').in('status', ['new', 'validated', 'fulfilling']).lt('created_at', stale);
    for (const o of late || []) {
      if (o.data?.digital) continue;
      await db.from('orders').update({ status: 'exception', data: { ...(o.data || {}), exception: 'Not shipped after 5 days' }, updated_at: new Date().toISOString() }).eq('id', o.id);
      await say('fulfillment', `Order ${o.external_id} hasn't shipped after 5 days. Check Printful.`, 'error');
    }
    return out;
  },
};

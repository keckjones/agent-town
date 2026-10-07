// Printful: watches print-on-demand orders that Printful's own Etsy integration created,
// and reports shipping, tracking, and problems back to the orders table. Status comes only from Printful.
import { config } from '../config.js';
import { db, setIntegration, say } from './db.js';

export async function syncPrintful() {
  if (!config.printful.token) return { skipped: 'not connected' };
  const res = await fetch('https://api.printful.com/orders?limit=50', {
    headers: { Authorization: `Bearer ${config.printful.token}` }, signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    await setIntegration('printful', 'Printful', 'error', `Printful ${res.status}: ${j.error?.message || j.result || ''}`.slice(0, 200), null, 'etsy');
    return { error: res.status };
  }
  let updated = 0;
  for (const o of j.result || []) {
    if (!o.external_id) continue;
    const ext = `etsy:${o.external_id}`;
    const { data: ord } = await db.from('orders').select('id, status, data').eq('external_id', ext).maybeSingle();
    if (!ord) continue;
    const map = { draft: 'validated', pending: 'fulfilling', inprocess: 'fulfilling', partial: 'fulfilling', fulfilled: 'shipped',
      onhold: 'exception', failed: 'exception', canceled: 'cancelled', archived: ord.status };
    const status = map[o.status] || ord.status;
    const tracking = (o.shipments || []).map((s) => ({ carrier: s.carrier, number: s.tracking_number, url: s.tracking_url, shipped_at: s.ship_date }));
    const cost = Number(o.costs?.total || 0);
    if (status !== ord.status || tracking.length !== (ord.data?.tracking || []).length) {
      await db.from('orders').update({ status, cost_usd: cost || null, data: { ...(ord.data || {}), printful_status: o.status, tracking }, updated_at: new Date().toISOString() }).eq('id', ord.id);
      updated++;
      if (status === 'exception') await say('fulfillment', `Printful order for ${ext} is ${o.status}. Needs your attention.`, 'error');
    }
    if (cost) await db.from('ledger').upsert({ division: 'etsy', category: 'fulfillment', amount_usd: cost, basis: 'actual', source: 'printful',
      external_id: `printful:${o.id}`, occurred_on: new Date((o.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10) }, { onConflict: 'external_id' });
  }
  await setIntegration('printful', 'Printful', 'connected', `Synced ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })}`, null, 'etsy');
  return { updated };
}

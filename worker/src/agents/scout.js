// Local Business Prospecting: finds businesses with the Google Places API (New) across the configured areas.
// Every contact detail keeps its source. Each new business starts a durable workflow.
import { config } from '../config.js';
import { db, say, enqueue, getSettings, countToday, setIntegration } from '../lib/db.js';
import { ensureWorkflow } from '../lib/workflows.js';

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount', 'places.primaryTypeDisplayName',
  'places.businessStatus', 'places.googleMapsUri', 'nextPageToken',
].join(',');

async function searchPlaces(textQuery, pageToken) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleApiKey, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery, pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const msg = `Google Places error ${res.status}: ${(await res.text()).slice(0, 300)}`;
    await setIntegration('google_places', 'Google Places', 'error', msg, 'Enable "Places API (New)" for the key in Google Cloud and check its API restrictions.', 'agency');
    throw new Error(msg);
  }
  return res.json();
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export const handlers = {
  async find_prospects(task) {
    if (!config.googleApiKey) throw new Error('GOOGLE_API_KEY is not set, so prospecting cannot search Google Places.');
    const settings = await getSettings();
    const areas = settings.outreach_areas?.length ? settings.outreach_areas : [settings.outreach_city];
    const city = task.input.city || pick(areas);
    const category = task.input.category || pick(settings.outreach_categories);
    const already = await countToday('prospects');
    const room = Math.max(0, settings.daily_prospect_cap - already);
    const want = Math.min(task.input.limit || 15, room);
    if (want === 0) {
      await say('scout', `Daily prospect cap (${settings.daily_prospect_cap}) reached.`);
      return { added: 0, reason: 'daily cap' };
    }

    await say('scout', `Searching for ${category} businesses in ${city}...`);
    let added = 0, seen = 0, pageToken = null, pages = 0;
    do {
      const data = await searchPlaces(`${category} in ${city}`, pageToken);
      pages++;
      await db.from('usage').insert({ agent_id: 'scout', service: 'places', cost_usd: 0.035, units: { requests: 1 } });
      for (const p of data.places || []) {
        if (added >= want) break;
        seen++;
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
        const observed = new Date().toISOString();
        const row = {
          place_id: p.id,
          name: p.displayName?.text || 'Unknown',
          category: p.primaryTypeDisplayName?.text || category,
          address: p.formattedAddress,
          city,
          phone: p.nationalPhoneNumber,
          website: p.websiteUri || null,
          rating: p.rating ?? null,
          review_count: p.userRatingCount ?? 0,
          contact_sources: [
            { field: 'phone', value: p.nationalPhoneNumber || null, source: 'Google Places', url: p.googleMapsUri || null, observed_at: observed },
            { field: 'website', value: p.websiteUri || null, source: 'Google Places', url: p.googleMapsUri || null, observed_at: observed },
          ],
          deal_stage: 'discovered',
        };
        const { data: inserted, error } = await db.from('prospects').upsert(row, { onConflict: 'place_id', ignoreDuplicates: true }).select();
        if (error) throw new Error(error.message);
        if (inserted && inserted.length) {
          added++;
          const pr = inserted[0];
          await ensureWorkflow({
            dedupeKey: `agency:prospect:${pr.id}`, division: 'agency', kind: 'agency_lead',
            objective: `Win ${pr.name} as a website client`, stage: 'verify', owner: 'inspector',
            subjectType: 'prospect', subjectId: pr.id, nextAction: 'Verify website and audit', budgetUsd: 1.5,
          });
          await enqueue('inspector', 'audit_site', { prospect_id: pr.id }, { createdBy: 'scout' });
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken && added < want && pages < 3);

    await setIntegration('google_places', 'Google Places', 'connected', `Last search ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`, null, 'agency');
    await say('scout', `Found ${added} new ${category} prospects in ${city} (${seen} checked).`, 'success');
    return { added, seen, category, city };
  },
};

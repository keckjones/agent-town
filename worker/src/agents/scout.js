// Scout Sam: finds local businesses with the Google Places API (New).
import { config } from '../config.js';
import { db, say, enqueue, getSettings, countToday } from '../lib/db.js';

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount', 'places.primaryTypeDisplayName',
  'places.businessStatus', 'nextPageToken',
].join(',');

async function searchPlaces(textQuery, pageToken) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googleApiKey,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({ textQuery, pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
  });
  if (!res.ok) throw new Error(`Google Places error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const handlers = {
  async find_prospects(task) {
    if (!config.googleApiKey) throw new Error('GOOGLE_API_KEY is not set, so the scout cannot search Google Places.');
    const settings = await getSettings();
    const city = task.input.city || settings.outreach_city;
    const category = task.input.category || settings.outreach_categories[Math.floor(Math.random() * settings.outreach_categories.length)];
    const already = await countToday('prospects');
    const room = Math.max(0, settings.daily_prospect_cap - already);
    const want = Math.min(task.input.limit || 15, room);
    if (want === 0) {
      await say('scout', `Daily prospect cap (${settings.daily_prospect_cap}) reached. Resting.`);
      return { added: 0, reason: 'daily cap' };
    }

    await say('scout', `Heading out to find ${category} businesses in ${city}...`);
    let added = 0, seen = 0, pageToken = null, pages = 0;
    do {
      const data = await searchPlaces(`${category} in ${city}`, pageToken);
      pages++;
      await db.from('usage').insert({ agent_id: 'scout', service: 'places', cost_usd: 0.035, units: { requests: 1 } });
      for (const p of data.places || []) {
        if (added >= want) break;
        seen++;
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
        const row = {
          place_id: p.id,
          name: p.displayName?.text || 'Unknown',
          category: p.primaryTypeDisplayName?.text || category,
          address: p.formattedAddress,
          phone: p.nationalPhoneNumber,
          website: p.websiteUri || null,
          rating: p.rating ?? null,
          review_count: p.userRatingCount ?? 0,
        };
        const { data: inserted, error } = await db.from('prospects').upsert(row, { onConflict: 'place_id', ignoreDuplicates: true }).select();
        if (error) throw new Error(error.message);
        if (inserted && inserted.length) {
          added++;
          await enqueue('inspector', 'audit_site', { prospect_id: inserted[0].id }, { createdBy: 'scout' });
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken && added < want && pages < 3);

    await say('scout', `Back from the field: ${added} new ${category} prospects (${seen} checked).`, 'success');
    return { added, seen, category, city };
  },
};

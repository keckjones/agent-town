// Reads replies arriving at agentickj@gmail.com (IMAP, same App Password as sending).
// Only messages that arrive AFTER the first connection are processed; old mail is never touched.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config, emailReady } from '../config.js';
import { db } from './db.js';

async function getState() { const { data } = await db.from('secrets').select('value').eq('id', 'imap_state').maybeSingle(); return data?.value || null; }
async function setState(v) { await db.from('secrets').upsert({ id: 'imap_state', value: v, updated_at: new Date().toISOString() }); }

/** Returns new messages as plain objects. Never marks mail as read or deletes anything. */
export async function fetchNewMail(max = 25) {
  if (!emailReady()) return [];
  const client = new ImapFlow({ host: config.imap.host, port: config.imap.port, secure: true,
    auth: { user: config.smtp.user, pass: config.smtp.pass }, logger: false });
  await client.connect();
  const out = [];
  try {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const state = await getState();
    if (!state || state.uidValidity !== String(box.uidValidity)) {
      await setState({ uidValidity: String(box.uidValidity), lastUid: (box.uidNext || 1) - 1 });
      return [];
    }
    let last = state.lastUid;
    for await (const msg of client.fetch({ uid: `${state.lastUid + 1}:*` }, { uid: true, source: true }, { uid: true })) {
      if (msg.uid <= state.lastUid) continue;
      const p = await simpleParser(msg.source);
      out.push({
        uid: msg.uid, messageId: p.messageId, inReplyTo: p.inReplyTo, references: [].concat(p.references || []),
        from: p.from?.value?.[0]?.address?.toLowerCase() || '', fromName: p.from?.value?.[0]?.name || '',
        subject: p.subject || '', text: (p.text || '').slice(0, 8000), date: p.date,
        autoReply: /auto-?reply|out of (the )?office|automatic reply/i.test(p.subject || '') || !!p.headers.get('auto-submitted') && p.headers.get('auto-submitted') !== 'no',
      });
      last = Math.max(last, msg.uid);
      if (out.length >= max) break;
    }
    await setState({ uidValidity: String(box.uidValidity), lastUid: last });
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

/** Strip the quoted previous message so classification looks only at what they wrote. */
export function newestPart(text) {
  const lines = String(text || '').split('\n');
  const cut = lines.findIndex((l) => /^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^>/.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim().slice(0, 3000);
}

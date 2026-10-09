// EntreBrew Daily の通知（GitHub Actions から5分ごとに実行）
//  1. メンション通知：新しい報告・連絡で、自分・自分の部署・@全員 がメンションされたら、すぐ知らせる
//  2. コメント通知：報告にコメントが付いたら、報告者と、同じ報告にコメントした人に知らせる
//  3. 広場の賞賛：賞賛された人に知らせる
//  4. 朝と夜のまとめ：各自が選んだ時刻に、新しい報告・未確認の連絡・タスクなどがあれば知らせる
import admin from 'firebase-admin';

const APP_URL = process.env.APP_URL || 'https://ando1518.github.io/entrebrew-daily/';
const BOARD = '取締役会';
const DEPT_ALIAS = { '経営管理部総務部': '経営管理総務部', '経営管理部経理部': '経営管理経理部' };
const normDepts = a => Array.isArray(a) ? [...new Set(a.map(d => DEPT_ALIAS[d] || d))] : [];
const DEFAULT_MORNING = 7, DEFAULT_EVENING = 20, WINDOW_H = 3;

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.log('::error::このリポジトリに FIREBASE_SERVICE_ACCOUNT が登録されていないため、通知を送れません（Settings → Secrets and variables → Actions で登録してください）');
  process.exit(0); // 5分ごとの失敗メールが大量に届かないよう、エラー表示だけにする
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

const nowMs = Date.now();
const jst = new Date(nowMs + 9 * 3600e3);
const today = jst.toISOString().slice(0, 10);
const tomorrow = new Date(nowMs + 33 * 3600e3).toISOString().slice(0, 10);
const nowH = jst.getUTCHours();
const testEmail = (process.env.TEST_EMAIL || '').trim().toLowerCase();
const forceSlot = (process.env.FORCE_SLOT || '').trim(); // morning / evening（テスト用）

const plain = (b, members) => (b || '')
  .replace(/@\{all\}/g, '@全員')
  .replace(/@\{g:([^}]{1,20})\}/g, (_, d) => '@' + (DEPT_ALIAS[d] || d))
  .replace(/@\{([A-Za-z0-9_\-.~:+]+)\}/g, (_, id) => '@' + ((members[id] || {}).name || 'メンバー'))
  .replace(/\s+/g, ' ').trim();
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

let stats = { mention: 0, comment: 0, kudos: 0, digest: 0, removed: 0, failed: 0 };
const deadTokens = new Set();

async function send(messages) {
  for (let i = 0; i < messages.length; i += 500) {
    const chunk = messages.slice(i, i + 500);
    const res = await admin.messaging().sendEach(chunk);
    res.responses.forEach((r, j) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'].includes(code)) deadTokens.add(chunk[j].token);
      else { stats.failed++; console.log('送信失敗:', code, r.error && r.error.message); }
    });
  }
}
const msg = (token, title, body, hash, tag) => ({
  token,
  notification: { title, body },
  webpush: { notification: { icon: APP_URL + 'icons/icon-192.png', tag, renotify: true }, fcmOptions: { link: APP_URL + (hash || '') } },
});

async function main() {
  const stateRef = db.doc('system/notify');
  const state = (await stateRef.get()).data() || {};
  const [memSnap, tokSnap] = await Promise.all([db.collection('members').get(), db.collection('pushTokens').get()]);
  const members = {};
  memSnap.docs.forEach(d => { const x = d.data(); members[d.id] = { ...x, depts: normDepts(x.depts) }; });
  let tokens = tokSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  if (testEmail) tokens = tokens.filter(t => (t.email || '').toLowerCase() === testEmail);
  const byUid = {};
  tokens.forEach(t => { if (t.uid) (byUid[t.uid] = byUid[t.uid] || []).push(t); });
  const board = Object.keys(members).filter(id => (members[id].depts || []).includes(BOARD));
  console.log(`日時 ${today} ${nowH}時 / 通知をオンにしている端末 ${tokens.length} 台`);
  if (testEmail && !forceSlot) {
    await send(tokens.map(t => msg(t.id, 'EntreBrew Daily テスト通知', 'この端末に通知が届いています。', '', 'eb-test')));
    console.log(`テスト通知を ${tokens.length} 台に送りました`);
    for (const tk of deadTokens) await db.collection('pushTokens').doc(tk).delete().catch(() => {});
    return;
  }

  // ---------- 1. メンション通知 ----------
  const since = state.lastReportAt || (nowMs - 10 * 60e3);
  const repSnap = await db.collection('reports').where('createdAt', '>', since).orderBy('createdAt').limit(200).get();
  let last = since;
  const mentionMsgs = [];
  for (const d of repSnap.docs) {
    const r = d.data();
    last = Math.max(last, r.createdAt || 0);
    const author = (members[r.author] || {}).name || 'メンバー';
    const rDepts = normDepts(r.depts);
    const why = {}; // uid -> 理由
    (r.mentions || []).forEach(u => { why[u] = why[u] || 'you'; });
    Object.entries(members).forEach(([u, m]) => {
      const hit = (m.depts || []).filter(x => rDepts.includes(x));
      if (hit.length && !why[u]) why[u] = '@' + hit[0];
    });
    if (r.all) Object.keys(members).forEach(u => { if (!why[u]) why[u] = '@全員'; });
    if (r.all || (r.mentions || []).length || rDepts.length) board.forEach(u => { if (!why[u]) why[u] = 'board'; });
    delete why[r.author];
    const body = clip(plain(r.body, members), 120);
    for (const [u, w] of Object.entries(why)) {
      for (const t of byUid[u] || []) {
        if (t.mention === false) continue;
        const title = w === 'you' ? `${author}さんからあなたへ` : w === 'board' ? `${author}さんの${r.cat || '報告'}` : `${author}さんから${w}へ`;
        mentionMsgs.push(msg(t.id, title, body, '#reports', 'eb-r-' + d.id));
      }
    }
  }
  if (mentionMsgs.length) { await send(mentionMsgs); stats.mention = mentionMsgs.length; }
  if (!testEmail) await stateRef.set({ lastReportAt: last, lastRunAt: nowMs }, { merge: true });

  // ---------- 2. コメント通知 ----------
  const cSince = state.lastCommentAt || (nowMs - 10 * 60e3);
  let cLast = cSince;
  try {
    const cSnap = await db.collection('comments').where('createdAt', '>', cSince).orderBy('createdAt').limit(200).get();
    const cMsgs = [], repCache = {};
    for (const d of cSnap.docs) {
      const c = d.data();
      cLast = Math.max(cLast, c.createdAt || 0);
      if (!c.reportId) continue;
      if (!(c.reportId in repCache)) {
        const [rs, others] = await Promise.all([
          db.collection(c.col === 'lounge' ? 'lounge' : 'reports').doc(c.reportId).get(),
          db.collection('comments').where('reportId', '==', c.reportId).get(),
        ]);
        repCache[c.reportId] = { r: rs.exists ? rs.data() : null, all: others.docs.map(x => x.data()) };
      }
      const { r, all } = repCache[c.reportId];
      if (!r) continue;
      const who = new Set([r.author]);
      all.forEach(x => { if ((x.createdAt || 0) < (c.createdAt || 0) && x.author) who.add(x.author); });
      who.delete(c.author);
      const name = (members[c.author] || {}).name || 'メンバー';
      const body = clip(plain(c.body, members), 120);
      for (const u of who) {
        const what = c.col === 'lounge' ? '投稿' : '報告';
        const title = u === r.author ? `${name}さんがあなたの${what}にコメント` : `${name}さんが${what}にコメント`;
        for (const t of byUid[u] || []) {
          if (t.mention === false) continue;
          cMsgs.push(msg(t.id, title, body, c.col === 'lounge' ? '#lounge' : '#reports', 'eb-c-' + c.reportId));
        }
      }
    }
    if (cMsgs.length) { await send(cMsgs); stats.comment = cMsgs.length; }
    if (!testEmail) await stateRef.set({ lastCommentAt: cLast }, { merge: true });
  } catch (e) {
    console.log('コメント通知をスキップしました:', e.message || e);
  }

  // ---------- 3. 広場の賞賛 ----------
  const kSince = state.lastLoungeAt || (nowMs - 10 * 60e3);
  let kLast = kSince;
  try {
    const lSnap = await db.collection('lounge').where('createdAt', '>', kSince).orderBy('createdAt').limit(200).get();
    const kMsgs = [];
    for (const d of lSnap.docs) {
      const p = d.data();
      kLast = Math.max(kLast, p.createdAt || 0);
      if (p.kind !== 'kudos') continue;
      const name = (members[p.author] || {}).name || 'メンバー';
      const body = clip(plain(p.body, members), 120) || '賞賛が届きました';
      for (const u of new Set(p.to || [])) {
        if (u === p.author) continue;
        for (const t of byUid[u] || []) {
          if (t.mention === false) continue;
          kMsgs.push(msg(t.id, `${name}さんから賞賛が届きました🎉`, body, '#lounge', 'eb-k-' + d.id));
        }
      }
    }
    if (kMsgs.length) { await send(kMsgs); stats.kudos = kMsgs.length; }
    if (!testEmail) await stateRef.set({ lastLoungeAt: kLast }, { merge: true });
  } catch (e) {
    console.log('賞賛の通知をスキップしました:', e.message || e);
  }

  // ---------- 4. 朝と夜のまとめ ----------
  const due = [];
  for (const t of tokens) {
    const mh = t.hour === null || t.hour === -1 ? null : Number(t.hour ?? DEFAULT_MORNING);
    const eh = t.eveningHour === null || t.eveningHour === -1 ? null : Number(t.eveningHour ?? DEFAULT_EVENING);
    const inWin = h => h !== null && nowH >= h && nowH < h + WINDOW_H;
    if (forceSlot === 'morning' || (!forceSlot && inWin(mh) && t.lastMorning !== today)) due.push([t, 'morning']);
    else if (forceSlot === 'evening' || (!forceSlot && inWin(eh) && t.lastEvening !== today)) due.push([t, 'evening']);
  }
  if (due.length) {
    const recentSnap = await db.collection('reports').where('createdAt', '>=', nowMs - 3 * 864e5).get();
    const recent = recentSnap.docs.map(d => ({ id: d.id, ...d.data(), depts: normDepts(d.data().depts) }));
    const [taskSnap, evSnap] = await Promise.all([db.collection('tasks').get(), db.collection('events').where('date', '==', today).get()]);
    const tasks = taskSnap.docs.map(d => ({ ...d.data(), depts: normDepts(d.data().depts) }));
    const events = evSnap.docs.map(d => d.data()).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    let lounge = [];
    try { lounge = (await db.collection('lounge').where('createdAt', '>=', nowMs - 2 * 864e5).get()).docs.map(d => d.data()); } catch (e) {}
    const mmdd = today.slice(5);
    const bdays = Object.entries(members).filter(([, m]) => m.birthday === mmdd);

    const digestMsgs = [];
    for (const [t, slot] of due) {
      const uid = t.uid, me = members[uid] || {}, myDepts = me.depts || [], isBoard = myDepts.includes(BOARD);
      const deptHits = ds => ds.length > 0 && (isBoard || ds.some(x => myDepts.includes(x)));
      const toMe = r => (r.mentions || []).includes(uid) || (r.author !== uid && (r.all || (isBoard && (r.mentions || []).length) || deptHits(r.depts)));
      const from = t.lastDigestAt || (nowMs - 24 * 3600e3);
      const fresh = recent.filter(r => r.author !== uid && (r.createdAt || 0) > from);
      const unread = recent.filter(r => toMe(r) && !(r.acks || {})[uid]);
      const mine = tasks.filter(x => x.status !== 'done' && (x.assignee === uid || deptHits(x.depts)) && x.due);
      const lines = [];
      if (fresh.length) {
        const names = [...new Set(fresh.map(r => (members[r.author] || {}).name).filter(Boolean))];
        lines.push(`新しい報告・連絡 ${fresh.length}件（${names.slice(0, 2).map(n => n + 'さん').join('・')}${names.length > 2 ? 'ほか' : ''}）`);
      }
      if (unread.length) lines.push(`未確認のあなた宛て ${unread.length}件`);
      const lgNew = lounge.filter(p => p.author !== uid && (p.createdAt || 0) > from);
      if (lgNew.length) {
        const kd = lgNew.filter(p => p.kind === 'kudos').length;
        lines.push(`広場の新しい投稿 ${lgNew.length}件${kd ? `（賞賛 ${kd}件）` : ''}`);
      }
      if (slot === 'morning') {
        const td = mine.filter(x => x.due <= today), od = td.filter(x => x.due < today).length;
        if (td.length) lines.push(`今日までのタスク ${td.length}件${od ? `（期限切れ ${od}件）` : ''}`);
        if (events.length) lines.push(`今日の予定：${events[0].time ? events[0].time + ' ' : ''}${events[0].title || ''}${events.length > 1 ? ` ほか${events.length - 1}件` : ''}`);
        const bd = bdays.filter(([id]) => id !== uid);
        if (bd.length) lines.push(`今日は${bd.map(([, m]) => (m.name || 'メンバー') + 'さん').join('、')}の誕生日です`);
      } else {
        const left = mine.filter(x => x.due <= today).length, tm = mine.filter(x => x.due === tomorrow).length;
        if (left) lines.push(`今日までで未完了のタスク ${left}件`);
        if (tm) lines.push(`明日が期限のタスク ${tm}件`);
      }
      const upd = slot === 'morning' ? { lastMorning: today } : { lastEvening: today };
      if (lines.length && !deadTokens.has(t.id)) {
        const name = me.name ? `${me.name}さん` : '';
        const title = slot === 'morning' ? `おはようございます${name ? '、' + name : ''}` : `今日のまとめ${name ? '（' + name + '）' : ''}`;
        digestMsgs.push(msg(t.id, title, lines.join('\n'), '', 'eb-' + slot));
        upd.lastDigestAt = nowMs;
      }
      if (!testEmail || forceSlot) await t.ref.update(upd).catch(() => {});
    }
    if (digestMsgs.length) { await send(digestMsgs); stats.digest = digestMsgs.length; }
  }

  for (const tk of deadTokens) { await db.collection('pushTokens').doc(tk).delete().catch(() => {}); stats.removed++; }
  console.log(`メンション通知 ${stats.mention} 件 / コメント通知 ${stats.comment} 件 / 賞賛 ${stats.kudos} 件 / まとめ ${stats.digest} 件 / 無効な端末の削除 ${stats.removed} 件 / 失敗 ${stats.failed} 件`);
  console.log(`::notice::通知オンの端末 ${tokens.length} 台 / メンション通知 ${stats.mention} 件 / コメント通知 ${stats.comment} 件 / 賞賛 ${stats.kudos} 件 / まとめ ${stats.digest} 件 / 無効端末の削除 ${stats.removed} 件 / 失敗 ${stats.failed} 件`);
}

main().catch(e => { console.error(e); process.exit(1); });

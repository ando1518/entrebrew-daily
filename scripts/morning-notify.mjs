// 毎朝の通知を送るスクリプト（GitHub Actions から実行）
// 通知をオンにした人ごとに、その日のタスク・予定・未確認の連絡をまとめて送る。
import admin from 'firebase-admin';

const APP_URL = process.env.APP_URL || 'https://ando1518.github.io/entrebrew-daily/';
const BOARD = '取締役会';
const DEPT_ALIAS = { '経営管理部総務部': '経営管理総務部', '経営管理部経理部': '経営管理経理部' };
// 実行した cron（UTC）→ 通知の時刻（日本時間）
const SCHEDULE_HOUR = { '50 20 * * *': 6, '50 21 * * *': 7, '50 22 * * *': 8, '50 23 * * *': 9 };

function log(...a) { console.log(...a); }

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.log('::warning::FIREBASE_SERVICE_ACCOUNT が設定されていないため、通知を送れませんでした。README の手順で設定してください。');
  process.exit(0);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

// 日本時間の「今」
const jst = new Date(Date.now() + 9 * 3600e3);
const today = jst.toISOString().slice(0, 10);
const mmdd = today.slice(5);
const nowHour = jst.getUTCHours();

const testEmail = (process.env.TEST_EMAIL || '').trim().toLowerCase();
let targetHour = SCHEDULE_HOUR[process.env.SCHEDULE || ''];
if (process.env.FORCE_HOUR) targetHour = Number(process.env.FORCE_HOUR);
if (targetHour === undefined) targetHour = Math.min(9, Math.max(6, nowHour + (jst.getUTCMinutes() >= 30 ? 1 : 0)));

const normDepts = a => Array.isArray(a) ? [...new Set(a.map(d => DEPT_ALIAS[d] || d))] : [];

async function main() {
  // 1. 送り先
  const tokSnap = await db.collection('pushTokens').get();
  let tokens = tokSnap.docs.map(d => ({ token: d.id, ...d.data() }));
  if (testEmail) tokens = tokens.filter(t => (t.email || '').toLowerCase() === testEmail);
  else tokens = tokens.filter(t => Number(t.hour || 7) === targetHour);
  log(`日付 ${today} / 対象 ${testEmail ? 'テスト: ' + testEmail : targetHour + '時'} / 送り先 ${tokens.length} 台`);
  if (!tokens.length) return;

  // 2. 必要なデータをまとめて読む
  const since = Date.now() - 14 * 864e5;
  const [memSnap, taskSnap, evSnap, repSnap] = await Promise.all([
    db.collection('members').get(),
    db.collection('tasks').get(),
    db.collection('events').where('date', '==', today).get(),
    db.collection('reports').where('createdAt', '>=', since).get(),
  ]);
  const members = {};
  memSnap.docs.forEach(d => { const x = d.data(); members[d.id] = { ...x, depts: normDepts(x.depts) }; });
  const tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data(), depts: normDepts(d.data().depts) }));
  const events = evSnap.docs.map(d => d.data()).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const reports = repSnap.docs.map(d => ({ id: d.id, ...d.data(), depts: normDepts(d.data().depts) }));
  const bdays = Object.entries(members).filter(([, m]) => m.birthday === mmdd).map(([id, m]) => ({ id, name: m.name || 'メンバー' }));

  // 3. 人ごとに本文を作る
  const cache = {};
  async function digest(uid) {
    if (cache[uid]) return cache[uid];
    const me = members[uid] || {};
    const myDepts = me.depts || [];
    const board = myDepts.includes(BOARD);
    const deptHits = ds => ds.length > 0 && (board || ds.some(d => myDepts.includes(d)));

    const unread = reports.filter(r => {
      if ((r.acks || {})[uid]) return false;
      if ((r.mentions || []).includes(uid)) return true;
      if (r.author === uid) return false;
      if (board && (r.mentions || []).length) return true;
      return deptHits(r.depts);
    }).length;
    const myTasks = tasks.filter(t => t.status !== 'done' && (t.assignee === uid || deptHits(t.depts)) && t.due && t.due <= today);
    const overdue = myTasks.filter(t => t.due < today).length;
    let todos = 0;
    try {
      const td = await db.collection(`users/${uid}/todos`).get();
      todos = td.docs.map(d => d.data()).filter(x => !x.done && x.due && x.due <= today).length;
    } catch (e) { /* 読めなくても続ける */ }

    const lines = [];
    if (unread) lines.push(`未確認の連絡 ${unread}件`);
    if (myTasks.length) lines.push(`今日までのタスク ${myTasks.length}件${overdue ? `（期限切れ ${overdue}件）` : ''}`);
    if (events.length) {
      const e = events[0];
      lines.push(`今日の予定：${e.time ? e.time + ' ' : ''}${e.title || ''}${events.length > 1 ? ` ほか${events.length - 1}件` : ''}`);
    }
    if (todos) lines.push(`今日のTODO ${todos}件`);
    const bd = bdays.filter(b => b.id !== uid);
    if (bd.length) lines.push(`今日は${bd.map(b => b.name + 'さん').join('、')}の誕生日です`);
    if (bdays.some(b => b.id === uid)) lines.unshift('お誕生日おめでとうございます！');
    if (!lines.length) lines.push('今日の予定やタスクはありません。良い一日を！');

    const name = me.name ? `、${me.name}さん` : '';
    return (cache[uid] = { title: `おはようございます${name}`, body: lines.join('\n') });
  }

  // 4. 送信
  const messages = [];
  for (const t of tokens) {
    if (!t.uid) continue;
    const d = await digest(t.uid);
    messages.push({
      token: t.token,
      notification: { title: d.title, body: d.body },
      webpush: {
        notification: { icon: APP_URL + 'icons/icon-192.png', tag: 'eb-morning', renotify: true },
        fcmOptions: { link: APP_URL },
      },
    });
  }
  let ok = 0, removed = 0, failed = 0;
  for (let i = 0; i < messages.length; i += 500) {
    const chunk = messages.slice(i, i + 500);
    const res = await admin.messaging().sendEach(chunk);
    for (let j = 0; j < res.responses.length; j++) {
      const r = res.responses[j];
      if (r.success) { ok++; continue; }
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') {
        await db.collection('pushTokens').doc(chunk[j].token).delete().catch(() => {});
        removed++;
      } else { failed++; console.log('送信失敗:', code, r.error && r.error.message); }
    }
  }
  log(`送信 ${ok} 件 / 無効な端末を削除 ${removed} 件 / 失敗 ${failed} 件`);
}

main().catch(e => { console.error(e); process.exit(1); });

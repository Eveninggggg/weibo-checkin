/**
 * Cookie 到期分析（零依赖）
 *
 * 微博移动端 Cookie 里的 ALF 字段是「过期时间戳（秒）」，
 * 由此可算出每个账号还剩几天。SSOLoginState 是登录时间戳，可算「已用天数」。
 */

/** 从 Cookie 串里取某个字段值 */
function getField(cookieStr, name) {
  const re = new RegExp('(?:^|;)\\s*' + name + '=([^;]*)');
  const m = String(cookieStr || '').match(re);
  return m ? m[1].trim() : '';
}

/**
 * 解析 ALF 字段为时间戳（秒）。
 *
 * 微博下发过两种形态：
 *   1) 纯数字         1794313553
 *   2) 带前缀         02_1794314021   （下划线前是版本/序号，后面才是时间戳）
 * 早期版本只认纯数字，导致第 2 种被判成「无 ALF → 无法判断到期」，
 * 明明还有 30 天却被列进「需重抓」名单。这里统一取最后一段数字。
 *
 * @returns {number|null} 时间戳（秒），解析不出返回 null
 */
function parseAlfTs(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  // 纯数字直接用
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // 形如 02_1794314021 / 02-1794314021：取最后一段连续数字
  const m = s.match(/(\d{9,})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 分析单个账号 Cookie 的时效。
 * @returns {{alf:number|null, sso:number|null, expireAt:string, loginAt:string, daysLeft:number|null, usedDays:number|null, level:string}}
 */
function analyzeCookie(cookieStr, nowSec) {
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  const alfRaw = getField(cookieStr, 'ALF');
  const ssoRaw = getField(cookieStr, 'SSOLoginState');

  const alf = parseAlfTs(alfRaw);
  const sso = /^\d+$/.test(ssoRaw) ? Number(ssoRaw) : null;

  let daysLeft = null;
  let level = 'unknown';
  if (alf) {
    daysLeft = (alf - now) / 86400;
    if (daysLeft < 0) level = 'expired';
    else if (daysLeft <= 3) level = 'critical';
    else if (daysLeft <= 7) level = 'warn';
    else if (daysLeft <= 15) level = 'notice';
    else level = 'ok';
  }

  const usedDays = sso ? (now - sso) / 86400 : null;

  return {
    alf,
    sso,
    expireAt: alf ? fmt(alf) : '',
    loginAt: sso ? fmt(sso) : '',
    daysLeft,
    usedDays,
    level,
  };
}

/** 时间戳(秒) → 北京时间字符串 */
function fmt(sec) {
  const d = new Date((sec + 8 * 3600) * 1000); // 转北京时间
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 等级 → 中文标签 */
function levelLabel(level) {
  return ({
    expired: '❌ 已过期',
    critical: '🔴 紧急',
    warn: '⚠️ 注意',
    notice: '⏳ 提醒',
    ok: '✅ 正常',
    unknown: '❔ 未知',
  })[level] || '❔ 未知';
}

/**
 * 需要提醒的天数阈值（默认 7 天，可用环境变量 COOKIE_WARN_DAYS 调整）。
 * 理由：微博 Cookie 有效期约 30 天。若阈值太大（如 15 天），
 * 刚抓完 Cookie 的第一周每天都会收到「即将到期」邮件，反而变成噪音。
 */
const WARN_DAYS = Number.isFinite(Number(process.env.COOKIE_WARN_DAYS))
  ? Number(process.env.COOKIE_WARN_DAYS)
  : 7;

/**
 * 批量分析账号数组。
 * @param {Array<{name:string,cookie:string}>} accounts
 * @returns {{rows:Array, soonExpiring:Array, expired:Array, needAlert:boolean, warnDays:number}}
 */
function analyzeAccounts(accounts, nowSec) {
  const rows = (accounts || []).map((a) => {
    const info = analyzeCookie(a.cookie, nowSec);
    return { name: a.name, ...info };
  });

  // 分档：剩余天数已算好，这里按阈值切成「需提醒 / 需紧急处理」两组
  const within = (r, days) => r.daysLeft !== null && r.daysLeft <= days;
  const soonExpiring = rows.filter((r) => within(r, WARN_DAYS));            // ≤7 天（含已过期）
  const urgent = rows.filter((r) => within(r, 3));                          // ≤3 天，标题里点名
  const expired = rows.filter((r) => r.level === 'expired');                // 已过期
  const needRefetch = rows.filter((r) => r.daysLeft === null);              // 没抓到 ALF，无法判断

  return {
    rows,
    soonExpiring,
    urgent,
    expired,
    needRefetch,
    needAlert: soonExpiring.length > 0,
    warnDays: WARN_DAYS,
  };
}

/** 生成控制台/日志用的文本表格
 * @param {Array} rows analyzeAccounts().rows
 * @param {Set<string>} [invalidSet] 已知登录态失效的账号名（覆盖天数显示）
 */
function formatTable(rows, invalidSet) {
  const bad = invalidSet instanceof Set ? invalidSet : new Set(invalidSet || []);
  const lines = [];
  lines.push('备注名'.padEnd(8) + '剩余天数'.padEnd(12) + '状态'.padEnd(12) + '到期时间(北京)');
  lines.push('-'.repeat(58));
  for (const r of rows) {
    const isBad = bad.has(r.name);
    const days = isBad ? '已失效' : (r.daysLeft === null ? '  -  ' : (r.daysLeft >= 0 ? r.daysLeft.toFixed(1) + ' 天' : '已过期'));
    const label = isBad ? '❌ 登录失效' : levelLabel(r.level);
    lines.push(
      String(r.name).padEnd(8) +
      String(days).padEnd(12) +
      String(label).padEnd(12) +
      (isBad ? '(需重抓)' : (r.expireAt || '(无 ALF 字段)'))
    );
  }
  return lines.join('\n');
}

/** 生成 HTML 表格（邮件用，微信/QQ 邮件客户端都能正常显示）
 * @param {Array} rows analyzeAccounts().rows
 * @param {Set<string>} [invalidSet] 已知登录态失效的账号名
 */
function formatHtmlTable(rows, invalidSet) {
  const bad = invalidSet instanceof Set ? invalidSet : new Set(invalidSet || []);
  const colorOf = (lv) => ({
    expired: '#cf222e', critical: '#cf222e', warn: '#bf8700', notice: '#0969da', ok: '#1a7f37', unknown: '#57606a',
  })[lv] || '#57606a';

  const trs = rows.map((r) => {
    const isBad = bad.has(r.name);
    const days = isBad ? '已失效' : (r.daysLeft === null ? '-' : (r.daysLeft >= 0 ? r.daysLeft.toFixed(1) + ' 天' : '已过期'));
    const label = isBad ? '❌ 登录失效' : levelLabel(r.level);
    const color = isBad ? '#cf222e' : colorOf(r.level);
    const expire = isBad ? '需重新抓取' : (r.expireAt || '-');
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e1e4e8">${escapeHtml(r.name)}</td>
      <td style="padding:6px 10px;border:1px solid #e1e4e8;color:${color};font-weight:600">${days}</td>
      <td style="padding:6px 10px;border:1px solid #e1e4e8;color:${color}">${label}</td>
      <td style="padding:6px 10px;border:1px solid #e1e4e8;font-size:12px;color:#57606a">${escapeHtml(expire)}</td>
    </tr>`;
  }).join('');

  return `<table style="border-collapse:collapse;font-family:-apple-system,'Microsoft YaHei',sans-serif;font-size:13px">
    <tr style="background:#f6f8fa">
      <th style="padding:6px 10px;border:1px solid #e1e4e8;text-align:left">账号</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8;text-align:left">剩余</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8;text-align:left">状态</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8;text-align:left">到期时间</th>
    </tr>${trs}</table>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

module.exports = { analyzeCookie, analyzeAccounts, formatTable, formatHtmlTable, levelLabel, getField, parseAlfTs };

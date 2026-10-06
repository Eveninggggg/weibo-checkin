#!/usr/bin/env node
/**
 * 微博超话签到 · 云端版主入口（GitHub Actions / 任意 Node 环境通用）
 *
 * Cookie 来源（按优先级）：
 *   1) 环境变量 WEIBO_ACCOUNTS  —— JSON 数组字符串（GitHub Secrets 推荐）
 *       格式：[{"name":"兔","cookie":"WEIBOCN_FROM=...; SUB=...; ..."}, ...]
 *   2) 环境变量 WEIBO_ACCOUNT_1 / WEIBO_ACCOUNT_2 ... —— 每个变量一条
 *       格式："备注名<换行或|或TAB>cookie字符串"
 *   3) 本地文件 accounts.json —— 便于本地调试（不提交到仓库）
 *
 * 关键词白名单（可选）：环境变量 WEIBO_KEYWORDS，逗号分隔；留空 = 签到全部超话
 *
 * 邮件通知（可选，见 mailer.js）：
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / ALERT_TO
 *   配置后：① 每次签到结果发邮件  ② Cookie 7 天内到期发预警  ③ Cookie 失效立刻告警
 *   MAIL_ALWAYS=0 可关闭「每次都发」，仅保留异常/预警邮件（默认每天都发）
 *
 * 用法：
 *   node index.js                # 正式执行
 *   node index.js --dry-run      # 只校验身份+拉列表，不签到（安全自检）
 *   node index.js --once         # 同上别名（明确单次执行）
 */
const fs = require('fs');
const path = require('path');
const { notify, mailConfigured, recipients } = require('./mailer');
const {
  analyzeCookie, analyzeAccounts, formatTable, formatHtmlTable, levelLabel,
} = require('./cookie-age');

const DRY_RUN = process.argv.includes('--dry-run');
const COOKIE_CHECK_ONLY = process.argv.includes('--cookie-only') || process.env.MAIL_MODE === 'cookie-only';

/**
 * 懒加载签到模块。
 * checkin.js 依赖 playwright（几百 MB），而 --cookie-only 体检模式完全不碰浏览器，
 * 所以不能在文件顶部无条件 require——否则光做 Cookie 体检也要先装好浏览器。
 */
function loadCheckin() {
  try {
    return require('./checkin');
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && /playwright/.test(e.message)) {
      log('❌ 缺少依赖 playwright。请先执行：npm install && npx playwright install chromium');
      log('   提示：只想检查 Cookie 剩余天数的话，用 node index.js --cookie-only（不需要浏览器）');
      process.exit(3);
    }
    throw e;
  }
}

function log(msg) {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${t}] ${msg}`);
}

/** 解析账号列表 */
function loadAccounts() {
  // 1) WEIBO_ACCOUNTS (JSON)
  const rawJson = process.env.WEIBO_ACCOUNTS;
  if (rawJson && rawJson.trim()) {
    try {
      const arr = JSON.parse(rawJson);
      if (Array.isArray(arr)) {
        return arr.map((a, i) => ({
          name: a.name || a.remark || `账号${i + 1}`,
          cookie: a.cookie || a.cookieStr || '',
        })).filter(a => a.cookie);
      }
    } catch (e) {
      log(`⚠️ WEIBO_ACCOUNTS 不是合法 JSON：${e.message}`);
    }
  }

  // 2) WEIBO_ACCOUNT_N
  const list = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (/^WEIBO_ACCOUNT_\d+$/.test(k) && v && v.trim()) {
      const t = v.trim();
      const m = t.match(/^([^\n\t|=]{1,30})[\n\t|=\s]+(.+)$/s);
      const cookie = m ? m[2].trim() : t;
      list.push({ name: m ? m[1].trim() : k, cookie });
    }
  }
  if (list.length) return list;

  // 3) 本地 accounts.json
  const p = path.join(__dirname, 'accounts.json');
  if (fs.existsSync(p)) {
    try {
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      return arr.map((a, i) => ({ name: a.name || `账号${i + 1}`, cookie: a.cookie || '' })).filter(a => a.cookie);
    } catch (e) {
      log(`⚠️ accounts.json 解析失败：${e.message}`);
    }
  }
  return [];
}

function loadKeywords() {
  const s = (process.env.WEIBO_KEYWORDS || '').trim();
  if (!s) return [];
  return s.split(/[,，]/).map(x => x.trim()).filter(Boolean);
}

async function main() {
  log('================ 微博超话签到（云端版）开始 ================');
  if (DRY_RUN) log('模式：DRY-RUN（只校验与拉列表，不执行签到）');
  if (mailConfigured()) {
    log(`邮件通知：已启用 → ${recipients().join(', ')}`);
  } else {
    log('邮件通知：未配置（如需开启，请设置 SMTP_HOST/SMTP_USER/SMTP_PASS）');
  }

  const accounts = loadAccounts();
  if (!accounts.length) {
    log('❌ 未找到任何账号。请配置 WEIBO_ACCOUNTS（JSON）或 WEIBO_ACCOUNT_N 环境变量。');
    if (mailConfigured()) {
      await notify(
        '【微博签到】配置异常：未找到任何账号',
        '签到脚本未找到任何账号。\n\n请检查 GitHub Secrets 中的 WEIBO_ACCOUNTS：\n' +
        '1) 名字必须是 WEIBO_ACCOUNTS（全大写+下划线）\n' +
        '2) 值必须是合法 JSON（可在 json.cn 校验）\n' +
        '3) 每个账号要有 name 和 cookie 两个字段'
      );
    }
    process.exit(2);
  }
  const keywords = loadKeywords();
  log(`账号数：${accounts.length}｜关键词白名单：${keywords.length ? keywords.join('、') : '（空 = 全部超话）'}`);

  // ===== Cookie 时效分析（先体检，再决定还要不要跑签到） =====
  const nowSec = Math.floor(Date.now() / 1000);
  const age = analyzeAccounts(accounts, nowSec);
  log('---------------- Cookie 到期倒计时 ----------------');
  formatTable(age.rows).split('\n').forEach(line => log(line));
  log('---------------------------------------------------');
  if (age.soonExpiring.length) {
    log(`⚠️ 有 ${age.soonExpiring.length} 个账号 Cookie 即将到期（${age.warnDays} 天内）：` +
      age.soonExpiring.map(r => `${r.name}(${r.daysLeft >= 0 ? r.daysLeft.toFixed(1) + '天' : '已过期'})`).join('、'));
  }

  // ---- 手动重抓 Cookie 模式：只体检 + 发信，不签到（可反复运行核对） ----
  if (COOKIE_CHECK_ONLY) {
    log('模式：COOKIE-CHECK-ONLY（只做 Cookie 时效体检，不执行签到）');
    await sendCookieOnlyMail({ accounts, age });
    log('体检完成。');
    return;
  }

  // 已过期的账号不必再浪费请求去跑，直接标记
  const expiredNames = new Set(age.expired.map(r => r.name));

  // 真正要签到了，这时才加载 playwright 相关模块
  const { checkinAccount } = loadCheckin();

  const topicGapMs = Number(process.env.WEIBO_TOPIC_GAP_MS || 4000);
  // 账号间隔：避免 22 个账号在同一秒内连续签到（这是最明显的机器特征）。
  //   · 单账号内部已有 4 秒超话间隔，但账号与账号之间原来是「零间隔接棒」；
  //   · 默认 30 秒，跑完最后一个账号不等，省时间；
  //   · 设 0 可关闭（例如本地调试）。
  const accountGapMs = Number(process.env.WEIBO_ACCOUNT_GAP_MS || 30000);

  let totalNew = 0, totalFail = 0, totalAlready = 0;
  const failures = [];
  const expiredAccounts = [];
  const accountResults = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const isLast = i === accounts.length - 1;

    // 已过期的直接跳过（省时间，且必然失败）
    if (expiredNames.has(acc.name)) {
      log(`—— 账号「${acc.name}」跳过：Cookie 已过期（${age.rows.find(r => r.name === acc.name).expireAt}）`);
      expiredAccounts.push(acc.name);
      failures.push(`${acc.name}: Cookie 已过期`);
      accountResults.push({ name: acc.name, status: 'expired', new: 0, already: 0, fail: 0, error: 'cookie_expired' });
      continue;
    }

    log(`—— 账号「${acc.name}」开始 ——`);
    const r = await checkinAccount(acc.cookie, keywords, { topicGapMs, log, dryRun: DRY_RUN });
    if (r.error) {
      log(`账号「${acc.name}」异常：${r.error}`);
      failures.push(`${acc.name}: ${r.error}`);
      if (r.error === 'not_logged_in') expiredAccounts.push(acc.name);
      accountResults.push({ name: acc.name, status: 'error', new: 0, already: 0, fail: 0, error: r.error });
      continue;
    }
    log(`账号「${acc.name}」(uid=${r.uid}) 完成：总${r.totalTopics} 命中${r.matchedTopics} 已签${r.checkedInBefore} 新签${r.newlyCheckedIn} 失败${r.failedCheckin}`);
    for (const t of r.topics) {
      log(`    · ${t.name} → ${t.action}${t.reason ? '（' + t.reason + '）' : ''}`);
    }
    totalNew += r.newlyCheckedIn;
    totalFail += r.failedCheckin;
    totalAlready += r.checkedInBefore;
    accountResults.push({
      name: acc.name, status: 'ok', new: r.newlyCheckedIn, already: r.checkedInBefore,
      fail: r.failedCheckin, uid: r.uid,
    });
    if (r.failedCheckin > 0) failures.push(`${acc.name}: ${r.failedCheckin} 个超话失败`);

    // 账号间隔：等上一个账号跑完再开下一个，模拟真人逐个操作（最后一个不等）
    if (accountGapMs > 0 && !isLast) {
      const jitter = Math.floor(Math.random() * accountGapMs * 0.6); // 0~60% 额外抖动
      const waitMs = accountGapMs + jitter;
      log(`⏳ 账号间隔：等待 ${(waitMs / 1000).toFixed(1)} 秒后继续下一个账号…`);
      await new Promise(res => setTimeout(res, waitMs));
    }
  }

  log('================ 汇总 ================');
  log(`新签：${totalNew}｜已签：${totalAlready}｜失败：${totalFail}`);
  if (failures.length) {
    log('失败明细：');
    failures.forEach(f => log('  · ' + f));
  } else {
    log('全部完成 ✅');
  }

  // ===== 邮件通知 =====
  await sendSummaryMail({
    accounts, age, accountResults, failures,
    expiredAccounts, totalNew, totalAlready, totalFail,
    dryRun: DRY_RUN,
  });

  if (failures.length) {
    process.exit(1); // 让 Actions 标记为失败，双重保险（GitHub 也会发通知）
  }
}

/**
 * 组装并发送汇总 / 告警邮件。
 * 邮件分级（标题一眼看出轻重）：
 *   ❌ 有 Cookie 失效 / 未登录 / 签到失败  → 必须处理
 *   ⚠️ 无失败但有 Cookie 进入提醒窗口      → 该准备重抓了
 *   ✅ 一切正常                            → 日常汇报（MAIL_ALWAYS=0 时只在异常时发）
 */
async function sendSummaryMail(ctx) {
  if (!mailConfigured()) return;

  const { accounts, age, accountResults, failures, expiredAccounts, totalNew, totalAlready, totalFail, dryRun } = ctx;
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const hasFail = failures.length > 0;
  const hasSoon = age.soonExpiring.length > 0;
  const mailAlways = process.env.MAIL_ALWAYS !== '0';

  // MAIL_ALWAYS=0 时，只有异常才发
  if (!mailAlways && !hasFail && !hasSoon) {
    log('[mail] 一切正常且 MAIL_ALWAYS=0，跳过发信');
    return;
  }

  // ---- 待重抓清单 ----
  // 两类：① 登录态已失效（跑签到报 not_logged_in）② 3 天内真到期
  // 去重合并，但显示原因时以「失效」优先——失效账号的 ALF 可能还剩很多天，
  // 不能拿天数去解释它为什么要重抓。
  const invalidSet = new Set(expiredAccounts);
  const refetchNames = [...new Set([...expiredAccounts, ...age.urgent.map(r => r.name)])];
  const refetchRow = (name) => {
    if (invalidSet.has(name)) return { name, left: '登录态已失效', bad: true };
    const r = age.rows.find(x => x.name === name);
    const left = r && r.daysLeft !== null
      ? (r.daysLeft >= 0 ? `还剩 ${r.daysLeft.toFixed(1)} 天` : '已过期')
      : '已失效';
    return { name, left, bad: false };
  };

  let subject;
  if (expiredAccounts.length) {
    subject = `【微博签到】❌ ${expiredAccounts.length} 个账号 Cookie 已失效，需重新抓取 (${today})`;
  } else if (hasFail) {
    subject = `【微博签到】❌ 有超话签到失败，请查看 (${today})`;
  } else if (refetchNames.length) {
    subject = `【微博签到】⚠️ ${refetchNames.length} 个账号 Cookie 3 天内到期，尽快重抓 (${today})`;
  } else if (hasSoon) {
    subject = `【微博签到】⏳ ${age.soonExpiring.length} 个账号 Cookie ${age.warnDays} 天内到期 (${today})`;
  } else {
    subject = `【微博签到】✅ 全部成功 新签${totalNew} (${today})`;
  }

  // ---------- 纯文本正文 ----------
  const L = [];
  L.push(`微博超话签到报告 — ${today}${dryRun ? '（DRY-RUN 测试）' : ''}`);
  L.push('='.repeat(46));
  L.push(`账号数：${accounts.length}`);
  L.push(`新签到：${totalNew}｜已签到：${totalAlready}｜失败：${totalFail}`);
  L.push('');

  if (expiredAccounts.length) {
    L.push('❌ Cookie 已失效的账号（需重新登录抓取）：');
    expiredAccounts.forEach(n => L.push(`   · ${n}`));
    L.push('');
  }

  if (refetchNames.length) {
    L.push(`🔁 建议现在就重抓 Cookie（共 ${refetchNames.length} 个）：`);
    refetchNames.forEach(n => {
      const row = refetchRow(n);
      L.push(`   · ${row.name}（${row.left}）`);
    });
    L.push('   → 处理：无痕窗口重新登录该账号 → F12 复制新 Cookie → 更新 Secret「WEIBO_ACCOUNTS」');
    L.push('');
  }

  if (hasSoon && !refetchNames.length) {
    L.push(`⚠️ Cookie 进入提醒窗口（${age.warnDays} 天内到期）：`);
    age.soonExpiring.forEach(r => {
      L.push(`   · ${r.name}：${r.daysLeft >= 0 ? '还剩 ' + r.daysLeft.toFixed(1) + ' 天' : '已过期'}（${r.expireAt}）`);
    });
    L.push('   → 不用急，但建议这几周找时间重抓一遍');
    L.push('');
  }

  if (age.needRefetch.length) {
    L.push(`❔ 无法判断有效期（Cookie 里没有 ALF 字段，共 ${age.needRefetch.length} 个）：`);
    L.push('   · ' + age.needRefetch.map(r => r.name).join('、'));
    L.push('   → 只要能签到成功就不影响使用，可忽略');
    L.push('');
  }

  const failTopics = failures.filter(f => !/Cookie 已过期/.test(f));
  if (failTopics.length) {
    L.push('❌ 失败明细：');
    failTopics.forEach(f => L.push('   · ' + f));
    L.push('');
  }

  L.push('---------------- Cookie 到期倒计时 ----------------');
  L.push(formatTable(age.rows, invalidSet));
  L.push('---------------------------------------------------');
  L.push('');
  L.push(`提示：微博 Cookie 有效期约 30 天，到期前重新抓取并更新 GitHub Secret 即可。`);
  L.push(`      提醒阈值当前为 ${age.warnDays} 天（想改成 5 天：把 Secret「COOKIE_WARN_DAYS」填 5）。`);
  L.push('本邮件由「微博超话签到（云端版）」自动发送 · 制作人：乐子人 · 仅供学习自用');

  // ---------- HTML 正文 ----------
  const H = [];
  const headColor = expiredAccounts.length || hasFail ? '#cf222e' : (hasSoon ? '#bf8700' : '#1a7f37');
  H.push(`<div style="font-family:-apple-system,'Microsoft YaHei',sans-serif;font-size:14px;color:#24292f;max-width:680px">`);
  H.push(`<h2 style="color:${headColor};margin:0 0 12px">微博超话签到报告 — ${today}</h2>`);

  // 顶部数据条
  H.push(`<table style="border-collapse:collapse;margin:4px 0 14px"><tr>`);
  const stat = (label, value, color) =>
    `<td style="padding:8px 16px;background:#f6f8fa;border:1px solid #e1e4e8;text-align:center">` +
    `<div style="font-size:11.5px;color:#57606a">${label}</div>` +
    `<div style="font-size:19px;font-weight:700;color:${color}">${value}</div></td>`;
  H.push(stat('账号数', accounts.length, '#24292f'));
  H.push(stat('新签到', totalNew, '#1a7f37'));
  H.push(stat('已签到', totalAlready, '#24292f'));
  H.push(stat('失败', totalFail, totalFail ? '#cf222e' : '#1a7f37'));
  if (age.soonExpiring.length) H.push(stat(`Cookie ≤${age.warnDays}天`, age.soonExpiring.length, '#bf8700'));
  H.push(`</tr></table>`);
  if (dryRun) H.push(`<p style="color:#8250df;margin:0 0 12px">（DRY-RUN 模式：只校验身份与拉列表，未真正签到）</p>`);

  if (expiredAccounts.length) {
    H.push(`<div style="background:#fdecec;border:1px solid #f5b5b5;border-radius:8px;padding:12px 16px;margin:12px 0">`);
    H.push(`<b style="color:#cf222e">❌ Cookie 已失效（${expiredAccounts.length} 个）</b><ul style="margin:6px 0;padding-left:20px">`);
    expiredAccounts.forEach(n => H.push(`<li>${escapeHtmlLite(n)}</li>`));
    H.push(`</ul></div>`);
  }

  if (refetchNames.length) {
    H.push(`<div style="background:#fff4e5;border:1px solid #ffcc80;border-radius:8px;padding:12px 16px;margin:12px 0">`);
    H.push(`<b style="color:#b06000">🔁 建议现在就重抓 Cookie（共 ${refetchNames.length} 个）</b>`);
    H.push(`<ul style="margin:6px 0;padding-left:20px">`);
    refetchNames.forEach(n => {
      const row = refetchRow(n);
      H.push(`<li><b>${escapeHtmlLite(row.name)}</b> — <span style="color:${row.bad ? '#cf222e' : '#b06000'}">${row.left}</span></li>`);
    });
    H.push(`</ul>`);
    H.push(`<div style="font-size:12.5px;color:#57606a;border-top:1px dashed #ffcc80;padding-top:8px">`);
    H.push(`处理步骤：开无痕窗口 → 登录该微博 → F12 → Network → 刷新 → 复制 Request Headers 里的 <code>Cookie</code> 整行 → 更新 Secret「WEIBO_ACCOUNTS」</div>`);
    H.push(`</div>`);
  }

  if (hasSoon && !refetchNames.length) {
    H.push(`<div style="background:#fff8e6;border:1px solid #ffe1a8;border-radius:8px;padding:12px 16px;margin:12px 0">`);
    H.push(`<b style="color:#bf8700">⏳ Cookie 进入提醒窗口（${age.warnDays} 天内到期）</b><ul style="margin:6px 0;padding-left:20px">`);
    age.soonExpiring.forEach(r => {
      H.push(`<li>${escapeHtmlLite(r.name)}：<b>${r.daysLeft >= 0 ? '还剩 ' + r.daysLeft.toFixed(1) + ' 天' : '已过期'}</b>（${r.expireAt}）</li>`);
    });
    H.push(`</ul><div style="font-size:12.5px;color:#57606a">不用急，但建议这几周找时间重抓一遍，避免某天突然失效。</div></div>`);
  }

  if (age.needRefetch.length) {
    H.push(`<div style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:8px;padding:10px 16px;margin:12px 0;font-size:12.5px;color:#57606a">`);
    H.push(`❔ <b>${age.needRefetch.length} 个账号</b>的 Cookie 里没有 ALF 字段，无法预判到期日：`);
    H.push(age.needRefetch.map(r => escapeHtmlLite(r.name)).join('、'));
    H.push(`　（能签到成功就不影响使用，可忽略）</div>`);
  }

  const failTopics2 = failures.filter(f => !/Cookie 已过期/.test(f));
  if (failTopics2.length) {
    H.push(`<div style="background:#fdecec;border:1px solid #f5b5b5;border-radius:8px;padding:12px 16px;margin:12px 0">`);
    H.push(`<b style="color:#cf222e">❌ 失败明细</b><ul style="margin:6px 0;padding-left:20px">`);
    failTopics2.forEach(f => H.push(`<li>${escapeHtmlLite(f)}</li>`));
    H.push(`</ul></div>`);
  }

  // 逐账号结果
  if (accountResults && accountResults.length) {
    H.push(`<h3 style="margin:18px 0 8px;font-size:15px">账号执行结果</h3>`);
    H.push(formatAccountHtml(accountResults));
  }

  H.push(`<h3 style="margin:18px 0 8px;font-size:15px">Cookie 到期倒计时</h3>`);
  H.push(formatHtmlTable(age.rows, invalidSet));
  H.push(`<p style="font-size:12px;color:#8a8f99;margin-top:16px;line-height:1.7">` +
    `微博 Cookie 有效期约 30 天，到期前重新抓取并更新 GitHub Secret 即可。<br>` +
    `提醒阈值当前 <b>${age.warnDays} 天</b>（想调整：新增 Secret「COOKIE_WARN_DAYS」填数字，如 5）。<br>` +
    `本邮件由「微博超话签到（云端版）」自动发送 · 制作人：乐子人 · 仅供学习自用</p>`);
  H.push(`</div>`);

  await notify(subject, L.join('\n'), H.join(''));
}

/** 逐账号执行结果 HTML 表 */
function formatAccountHtml(rows) {
  const badge = (r) => {
    if (r.status === 'expired') return '<span style="color:#cf222e">❌ 已失效</span>';
    if (r.status === 'error') return `<span style="color:#cf222e">❌ ${escapeHtmlLite(r.error || '异常')}</span>`;
    if (r.fail > 0) return '<span style="color:#bf8700">⚠️ 部分失败</span>';
    return '<span style="color:#1a7f37">✅ 正常</span>';
  };
  const trs = rows.map((r) => `<tr>
    <td style="padding:6px 10px;border:1px solid #e1e4e8">${escapeHtmlLite(r.name)}</td>
    <td style="padding:6px 10px;border:1px solid #e1e4e8">${badge(r)}</td>
    <td style="padding:6px 10px;border:1px solid #e1e4e8;text-align:center">${r.new}</td>
    <td style="padding:6px 10px;border:1px solid #e1e4e8;text-align:center">${r.already}</td>
    <td style="padding:6px 10px;border:1px solid #e1e4e8;text-align:center;color:${r.fail ? '#cf222e' : '#57606a'}">${r.fail}</td>
  </tr>`).join('');
  return `<table style="border-collapse:collapse;font-family:-apple-system,'Microsoft YaHei',sans-serif;font-size:13px">
    <tr style="background:#f6f8fa">
      <th style="padding:6px 10px;border:1px solid #e1e4e8;text-align:left">账号</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8;text-align:left">状态</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8">新签</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8">已签</th>
      <th style="padding:6px 10px;border:1px solid #e1e4e8">失败</th>
    </tr>${trs}</table>`;
}

/** 只做 Cookie 体检时发的邮件（--cookie-only） */
async function sendCookieOnlyMail({ accounts, age }) {
  if (!mailConfigured()) {
    log('[mail] 未配置 SMTP，跳过发信（上方日志已打印倒计时表）');
    return;
  }
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const refetch = [...new Set([...age.expired.map(r => r.name), ...age.urgent.map(r => r.name)])];

  let subject;
  if (age.expired.length) subject = `【Cookie 体检】❌ ${age.expired.length} 个账号已失效 (${today})`;
  else if (refetch.length) subject = `【Cookie 体检】🔁 ${refetch.length} 个账号需重抓 (${today})`;
  else if (age.soonExpiring.length) subject = `【Cookie 体检】⏳ ${age.soonExpiring.length} 个账号即将到期 (${today})`;
  else subject = `【Cookie 体检】✅ ${accounts.length} 个账号全部正常 (${today})`;

  const L = [];
  L.push(`微博 Cookie 体检报告 — ${today}`);
  L.push('='.repeat(46));
  L.push(`共 ${accounts.length} 个账号`);
  L.push('');
  if (refetch.length) {
    L.push(`🔁 建议重抓（已失效或 3 天内到期）：${refetch.join('、')}`);
  } else if (age.soonExpiring.length) {
    L.push(`⏳ 即将到期（${age.warnDays} 天内）：${age.soonExpiring.map(r => r.name).join('、')}`);
  } else {
    const mins = age.rows.filter(r => r.daysLeft !== null).map(r => r.daysLeft);
    L.push(`✅ 没有账号进入提醒窗口${mins.length ? `（最短剩余 ${Math.min(...mins).toFixed(1)} 天）` : ''}`);
  }
  L.push('');
  L.push(formatTable(age.rows));
  L.push('');
  L.push('本邮件由「微博超话签到（云端版）」Cookie 体检模式发送 · 制作人：乐子人');

  const H = [];
  H.push(`<div style="font-family:-apple-system,'Microsoft YaHei',sans-serif;font-size:14px;color:#24292f;max-width:680px">`);
  H.push(`<h2 style="margin:0 0 12px;color:${refetch.length || age.expired.length ? '#cf222e' : (age.soonExpiring.length ? '#bf8700' : '#1a7f37')}">微博 Cookie 体检报告 — ${today}</h2>`);
  H.push(`<p style="margin:8px 0">共 <b>${accounts.length}</b> 个账号　进入提醒窗口：<b>${age.soonExpiring.length}</b>　已失效：<b style="color:${age.expired.length ? '#cf222e' : '#1a7f37'}">${age.expired.length}</b></p>`);
  if (refetch.length) {
    H.push(`<div style="background:#fff4e5;border:1px solid #ffcc80;border-radius:8px;padding:12px 16px;margin:12px 0">`);
    H.push(`<b style="color:#b06000">🔁 建议现在就重抓：</b>${refetch.map(escapeHtmlLite).join('、')}`);
    H.push(`<div style="font-size:12.5px;color:#57606a;margin-top:6px">无痕窗口重新登录 → F12 复制 Cookie → 更新 Secret「WEIBO_ACCOUNTS」</div></div>`);
  }
  H.push(`<h3 style="margin:18px 0 8px;font-size:15px">到期倒计时</h3>`);
  H.push(formatHtmlTable(age.rows, new Set(refetch)));
  H.push(`<p style="font-size:12px;color:#8a8f99;margin-top:16px">本邮件由「微博超话签到（云端版）」Cookie 体检模式发送 · 制作人：乐子人</p>`);
  H.push(`</div>`);

  await notify(subject, L.join('\n'), H.join(''));
}

/** 邮件正文用的极简转义（不引外部依赖，保持自包含） */
function escapeHtmlLite(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

main().catch(async (e) => {
  log(`❌ 致命错误：${(e && e.stack) || e}`);
  if (mailConfigured()) {
    await notify(
      '【微博签到】❌ 脚本异常退出',
      `签到脚本发生未预期错误：\n\n${(e && e.stack) || e}\n\n请到 GitHub Actions 页面查看完整日志。`
    );
  }
  process.exit(1);
});

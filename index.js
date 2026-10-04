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
 * 用法：
 *   node index.js                # 正式执行
 *   node index.js --dry-run      # 只校验身份+拉列表，不签到（安全自检）
 *   node index.js --once         # 同上别名（明确单次执行）
 */
const fs = require('fs');
const path = require('path');
const { checkinAccount } = require('./checkin');

const DRY_RUN = process.argv.includes('--dry-run');

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

  const accounts = loadAccounts();
  if (!accounts.length) {
    log('❌ 未找到任何账号。请配置 WEIBO_ACCOUNTS（JSON）或 WEIBO_ACCOUNT_N 环境变量。');
    process.exit(2);
  }
  const keywords = loadKeywords();
  log(`账号数：${accounts.length}｜关键词白名单：${keywords.length ? keywords.join('、') : '（空 = 全部超话）'}`);

  const topicGapMs = Number(process.env.WEIBO_TOPIC_GAP_MS || 4000);

  let totalNew = 0, totalFail = 0, totalAlready = 0;
  const failures = [];

  for (const acc of accounts) {
    log(`—— 账号「${acc.name}」开始 ——`);
    const r = await checkinAccount(acc.cookie, keywords, { topicGapMs, log, dryRun: DRY_RUN });
    if (r.error) {
      log(`账号「${acc.name}」异常：${r.error}`);
      failures.push(`${acc.name}: ${r.error}`);
      continue;
    }
    log(`账号「${acc.name}」(uid=${r.uid}) 完成：总${r.totalTopics} 命中${r.matchedTopics} 已签${r.checkedInBefore} 新签${r.newlyCheckedIn} 失败${r.failedCheckin}`);
    for (const t of r.topics) {
      log(`    · ${t.name} → ${t.action}${t.reason ? '（' + t.reason + '）' : ''}`);
    }
    totalNew += r.newlyCheckedIn;
    totalFail += r.failedCheckin;
    totalAlready += r.checkedInBefore;
    if (r.failedCheckin > 0) failures.push(`${acc.name}: ${r.failedCheckin} 个超话失败`);
  }

  log('================ 汇总 ================');
  log(`新签：${totalNew}｜已签：${totalAlready}｜失败：${totalFail}`);
  if (failures.length) {
    log('失败明细：');
    failures.forEach(f => log('  · ' + f));
    process.exit(1); // 让 Actions 标记为失败，便于你收到通知
  }
  log('全部完成 ✅');
}

main().catch(e => {
  log(`❌ 致命错误：${(e && e.stack) || e}`);
  process.exit(1);
});

/**
 * 微博超话签到 · 云端版核心逻辑
 * 复用桌面插件已验证的两条关键结论：
 *   1) 签到(button)请求必须从「页面上下文」发起（SW/纯 HTTP 会被风控 403·errno:100015）
 *   2) sign 会过期，遇 100015 需重新拉列表换新 sign 重试一次
 *
 * 以 Playwright 无头浏览器打开 m.weibo.cn 页面，在页面内 fetch 完成签到。
 */
const { chromium } = require('playwright');

const ORIGIN = 'https://m.weibo.cn';
const LIST_API = ORIGIN + '/api/container/getIndex?containerid=100803_-_followsuper';
const REFERER = ORIGIN + '/p/tabbar?containerid=100803_-_recentvisit&page_type=tabbar';

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

/** Cookie 字符串 → Playwright cookie 数组 */
function parseCookies(cookieStr, domain = '.weibo.cn') {
  return String(cookieStr || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(kv => {
      const i = kv.indexOf('=');
      if (i <= 0) return null;
      return { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), domain, path: '/' };
    })
    .filter(Boolean);
}

/** 安全转字符串并截断（JSON.stringify 可能因循环引用返回 undefined） */
function safeStr(v, max) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return String(s == null ? '' : s).slice(0, max || 200);
  } catch (e) {
    return String(v == null ? '' : v).slice(0, max || 200);
  }
}

/** 关键词匹配（与插件一致：空=全部；支持 | 或 , 分隔的「或」组） */
function matchKeyword(topicName, includeKeywords) {
  const list = (includeKeywords || []).map(s => String(s).trim()).filter(Boolean);
  if (!list.length) return true;
  const name = String(topicName || '');
  return list.some(k => {
    const alts = k.split(/[|,]|\s+/).map(x => x.trim()).filter(Boolean);
    return alts.some(a => name.indexOf(a) !== -1);
  });
}

/** 从超话列表响应中提取 [{ name, level, canCheckin, scheme }] */
function extractTopics(data) {
  const out = [];
  const cards = (data && data.data && data.data.cards) || [];
  for (const card of cards) {
    for (const item of (card.card_group || [])) {
      if (!item || !item.title_sub || !item.buttons) continue;
      let canCheckin = false;
      let scheme = '';
      let status = '未知';
      for (const btn of item.buttons) {
        const nm = (btn && btn.name) || '';
        if (nm === '签到' || (nm.indexOf('签到') !== -1 && nm.indexOf('已') === -1)) {
          canCheckin = true; scheme = btn.scheme || ''; status = '可签到'; break;
        }
        if (nm.indexOf('已签') !== -1 || ['今日已签', '明日再来'].indexOf(nm) !== -1) {
          status = '已签到'; break;
        }
      }
      out.push({ name: item.title_sub, level: item.desc1 || '', canCheckin, scheme, status });
    }
  }
  return out;
}

/** 在页面上下文里发 fetch（等价真人点按钮的网络环境） */
async function pageFetch(page, url) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, {
        headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      // 注意：某些情况下（被风控拦截 / 连接被重置）响应体可能读不到，
      // r.text() 会返回 undefined 甚至抛错，这里必须兜底，否则 .slice 会崩。
      let text = '';
      try { text = await r.text(); } catch (e) { text = ''; }
      if (typeof text !== 'string') text = String(text == null ? '' : text);
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      return { status: r.status, data, raw: text.slice(0, 300) };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }, url);
}

/**
 * 单账号签到。返回结果对象（不抛异常）。
 * @param {string} cookieStr 账号 Cookie
 * @param {string[]} includeKeywords 关键词白名单
 * @param {object} opt { topicGapMs, log }
 */
async function checkinAccount(cookieStr, includeKeywords = [], opt = {}) {
  const topicGapMs = Number.isFinite(opt.topicGapMs) ? opt.topicGapMs : 4000;
  const log = typeof opt.log === 'function' ? opt.log : () => {};
  const dryRun = !!opt.dryRun;
  const result = {
    ok: false, uid: '', nickname: '',
    totalTopics: 0, matchedTopics: 0, checkedInBefore: 0,
    newlyCheckedIn: 0, failedCheckin: 0, topics: [], error: '',
  };

  const browser = await chromium.launch({
    headless: true,
    // 允许用环境变量指定浏览器可执行文件（本地/特殊环境），未设置时用 Playwright 自带 Chromium
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: UA_MOBILE,
      viewport: { width: 390, height: 844 },
      locale: 'zh-CN',
    });
    await ctx.addCookies(parseCookies(cookieStr));

    const page = await ctx.newPage();
    // 打开移动端首页，建立页面上下文
    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 1) 校验身份
    const cfg = await pageFetch(page, ORIGIN + '/api/config');
    const info = cfg.data && cfg.data.data;
    if (!info || !info.login) {
      result.error = 'not_logged_in';
      log(`登录态校验未通过（可能 Cookie 已失效）: ${safeStr(cfg.data, 160)}`);
      return result;
    }
    result.uid = String(info.uid || '');
    result.nickname = info.nickname || info.screen_name || '';
    log(`身份校验通过 uid=${result.uid} 昵称=${result.nickname || '无'}`);

    // 2) 拉取超话列表
    let list = await pageFetch(page, LIST_API);
    if (!list.data || list.data.ok !== 1) {
      result.error = 'list_failed';
      log(`超话列表拉取失败: HTTP ${list.status}`);
      return result;
    }
    let topics = extractTopics(list.data);
    result.totalTopics = topics.length;
    log(`超话列表获取成功，共 ${topics.length} 个`);

    // 3) 逐个处理
    for (const t of topics) {
      if (!matchKeyword(t.name, includeKeywords)) continue;
      result.matchedTopics += 1;

      if (!t.canCheckin) {
        result.checkedInBefore += 1;
        result.topics.push({ name: t.name, level: t.level, action: '已签到' });
        log(`「${t.name}」已签到 → 跳过`);
        continue;
      }

      if (dryRun) {
        result.topics.push({ name: t.name, level: t.level, action: '待签到（dry-run 跳过）' });
        log(`「${t.name}」待签到（dry-run 模式，未执行）`);
        continue;
      }

      // 签到（页面上下文）
      let r = await pageFetch(page, t.scheme.startsWith('http') ? t.scheme : ORIGIN + t.scheme);
      if (r.data && r.data.ok === 1) {
        result.newlyCheckedIn += 1;
        result.topics.push({ name: t.name, level: t.level, action: '签到成功' });
        log(`「${t.name}」✅ 签到成功`);
      } else {
        const errno = String((r.data && r.data.errno) || '');
        // sign 过期自救：重新拉列表换新 sign 重试一次
        if (errno === '100015') {
          log(`「${t.name}」遇 100015，重拉列表换新签名后重试…`);
          const fresh = await pageFetch(page, LIST_API);
          const freshTopics = extractTopics(fresh.data || {});
          const ft = freshTopics.find(x => x.name === t.name);
          if (ft && ft.canCheckin && ft.scheme && ft.scheme !== t.scheme) {
            await new Promise(res => setTimeout(res, 800 + Math.random() * 500));
            const r2 = await pageFetch(page, ft.scheme.startsWith('http') ? ft.scheme : ORIGIN + ft.scheme);
            if (r2.data && r2.data.ok === 1) {
              result.newlyCheckedIn += 1;
              result.topics.push({ name: t.name, level: t.level, action: '签到成功(换签名重试)' });
              log(`「${t.name}」✅ 重试成功`);
              r = r2;
            } else { r = r2; }
          }
        }
        if (!(r.data && r.data.ok === 1)) {
          result.failedCheckin += 1;
          const msg = (r.data && (r.data.msg || r.data.errno || r.data.ok)) || r.error || `HTTP ${r.status}`;
          result.topics.push({ name: t.name, level: t.level, action: '签到失败', reason: String(msg) });
          log(`「${t.name}」❌ 签到失败: ${safeStr(r.data || r, 160)}`);
        }
      }
      // 超话间隔（含随机抖动，降低机器特征）
      await new Promise(res => setTimeout(res, topicGapMs + Math.random() * 2000));
    }

    result.ok = true;
    return result;
  } catch (e) {
    result.error = String((e && e.message) || e);
    log(`异常: ${result.error}`);
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { checkinAccount, parseCookies, matchKeyword, extractTopics };

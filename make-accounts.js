#!/usr/bin/env node
/**
 * 账号 JSON 生成器：把「备注名 + Cookie」快速转成 WEIBO_ACCOUNTS 的 JSON 字符串。
 *
 * 用法：
 *   node make-accounts.js
 *   然后按提示逐条粘贴（备注名 回车 Cookie），输入空行结束。
 *   生成结果会打印到屏幕，并写入 accounts.json。
 *
 * 也支持批量模式：直接编辑本文件同目录的 accounts.txt
 *   每行格式：备注名<TAB或|或空格>Cookie字符串
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TXT = path.join(__dirname, 'accounts.txt');

function buildJson(list) {
  return JSON.stringify(list, null, 0); // 一行紧凑格式，便于粘贴进 GitHub Secret
}

function fromTxtFile() {
  if (!fs.existsSync(TXT)) return null;
  const lines = fs.readFileSync(TXT, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const list = lines.map((line, i) => {
    const m = line.match(/^([^\t|=]{1,30})[\t|=\s]+(.+)$/);
    return m ? { name: m[1].trim(), cookie: m[2].trim() } : { name: `账号${i + 1}`, cookie: line };
  }).filter(a => a.cookie);
  return list.length ? list : null;
}

async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));
  const list = [];
  console.log('=== 微博账号 JSON 生成器 ===');
  console.log('逐条输入：先填备注名，再粘贴 Cookie。直接回车（备注名留空）结束。\n');
  while (true) {
    const name = (await ask('备注名（留空结束）：')).trim();
    if (!name) break;
    const cookie = (await ask('Cookie：')).trim();
    if (!cookie) { console.log('  ⚠️ Cookie 为空，跳过\n'); continue; }
    list.push({ name, cookie });
    console.log(`  ✅ 已添加「${name}」（Cookie 长度 ${cookie.length}）\n`);
  }
  rl.close();
  return list;
}

(async () => {
  let list = fromTxtFile();
  if (list) {
    console.log(`检测到 accounts.txt，已读取 ${list.length} 个账号。`);
  } else {
    list = await interactive();
  }
  if (!list.length) { console.log('没有账号，退出。'); return; }

  const json = buildJson(list);
  fs.writeFileSync(path.join(__dirname, 'accounts.json'), JSON.stringify(list, null, 2));
  console.log('\n===== 复制下面这一整行，粘贴到 GitHub Secret「WEIBO_ACCOUNTS」=====\n');
  console.log(json);
  console.log('\n==================================================================');
  console.log(`\n共 ${list.length} 个账号。同时已保存到 accounts.json（本地调试用，不会上传）。`);
})();

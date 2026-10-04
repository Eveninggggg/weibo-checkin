/**
 * 邮件通知模块（零依赖，用 Node 内置 net/tls 直连 SMTP）
 *
 * 环境变量：
 *   SMTP_HOST   如 smtp.qq.com / smtp.163.com / smtp.gmail.com
 *   SMTP_PORT   465（SSL，默认） 或 587（STARTTLS）
 *   SMTP_USER   发件邮箱，如 xxx@qq.com
 *   SMTP_PASS   发件邮箱的 SMTP 授权码（不是登录密码！）
 *   ALERT_TO    收件邮箱，多个用英文逗号分隔；不填则发给 SMTP_USER 自己
 *   ALERT_FROM_NAME  发件人显示名（可选，默认「微博签到助手」）
 *
 * 未配置 SMTP_HOST/SMTP_USER/SMTP_PASS 时自动跳过发信，只打印日志（静默降级）。
 */
const net = require('net');
const tls = require('tls');

/** 是否已配置邮件 */
function mailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * 把邮件头按 RFC2047 编码（保证中文标题/发件人名不乱码）。
 * 同时按 RFC5322 折行：单行不超过 76 字符，否则超长标题会被服务器拒收
 * （常见报错：500 Line too long）。
 */
function encodeHeader(str) {
  const b64 = Buffer.from(String(str), 'utf8').toString('base64');
  // 单个 encoded-word 的内容部分最多 75 字符，留出编码标记的余量取 60 更稳
  const CHUNK = 60;
  if (b64.length <= CHUNK) return '=?UTF-8?B?' + b64 + '?=';
  // 超长时拆成多个 encoded-word，用 CRLF + 空格 折行（RFC2047 允许）
  const words = [];
  for (let i = 0; i < b64.length; i += CHUNK) {
    words.push('=?UTF-8?B?' + b64.slice(i, i + CHUNK) + '?=');
  }
  return words.join('\r\n ');
}

/**
 * 正文做 base64 传输编码，并按 RFC2045 每 76 字符折行。
 * ⚠️ 必须折行：SMTP 规定单行最长 998 字符（RFC5321 4.5.3.1），
 * 内容（如多账号倒计时表）base64 后很容易超长，不折行会被服务器拒绝。
 */
function encodeBody(str) {
  const b64 = Buffer.from(String(str), 'utf8').toString('base64');
  const out = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join('\r\n');
}

/** 收件人列表 */
function recipients() {
  const to = (process.env.ALERT_TO || process.env.SMTP_USER || '').trim();
  return to.split(/[,，;；\s]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * 通过 SMTP 发一封邮件。
 * @param {{subject:string, text:string, html?:string}} mail
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
function sendMail(mail) {
  return new Promise((resolve) => {
    if (!mailConfigured()) {
      resolve({ ok: false, error: 'smtp_not_configured' });
      return;
    }
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const fromName = process.env.ALERT_FROM_NAME || '微博签到助手';
    const to = recipients();
    if (!to.length) {
      resolve({ ok: false, error: 'no_recipient' });
      return;
    }

    const useSSL = port === 465;
    const boundary = '----weibo_checkin_' + Date.now();

    // To 头折行：多个收件人时单行可能超过 998 字符限制
    const foldHeader = (name, value) => {
      const parts = [];
      let cur = `${name}:`;
      const items = String(value).split(',');
      for (const it of items) {
        const piece = it.trim() + ',';
        if ((cur + ' ' + piece).length > 76 && cur.length > name.length + 1) {
          parts.push(cur.replace(/,$/, ''));
          cur = ' ' + piece;
        } else {
          cur += ' ' + piece;
        }
      }
      parts.push(cur.replace(/,$/, ''));
      return parts.join('\r\n');
    };

    const headers = [
      `From: ${encodeHeader(fromName)} <${user}>`,
      foldHeader('To', to.join(', ')),
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@weibo-checkin>`,
    ];

    let body;
    if (mail.html) {
      // 多部分：纯文本 + HTML 两个版本
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      body = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        encodeBody(mail.text),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        encodeBody(mail.html),
        `--${boundary}--`,
      ].join('\r\n');
    } else {
      headers.push('Content-Type: text/plain; charset=UTF-8');
      headers.push('Content-Transfer-Encoding: base64');
      body = encodeBody(mail.text);
    }

    const message = headers.join('\r\n') + '\r\n\r\n' + body + '\r\n';

    let socket = null;
    let finished = false;

    const finish = (res) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { if (socket) socket.end(); } catch (e) {}
      resolve(res);
    };
    const timeout = setTimeout(() => finish({ ok: false, error: 'smtp_timeout' }), 30000);

    // 逐条命令发送 + 等待期望状态码
    // 关键：用「待处理行队列 + 等待者」实现，连接后立刻挂监听，避免丢失服务器先发的问候
    let lineQueue = [];
    let waiting = null;
    let replyBuf = '';

    const pushLine = (line) => {
      if (waiting) {
        const w = waiting;
        waiting = null;
        w(line);
      } else {
        lineQueue.push(line);
      }
    };

    const onData = (chunk) => {
      replyBuf += chunk.toString('utf8');
      let idx;
      while ((idx = replyBuf.indexOf('\r\n')) !== -1) {
        const line = replyBuf.slice(0, idx);
        replyBuf = replyBuf.slice(idx + 2);
        if (line[3] === '-') continue; // 多行响应（250-xxx）继续等
        if (!/^\d{3}/.test(line)) continue;
        pushLine(line);
      }
    };

    /** 取下一行响应（优先取队列里已到达的） */
    const readLine = () => new Promise((res) => {
      if (lineQueue.length) res(lineQueue.shift());
      else waiting = res;
    });

    const expectCode = async (codes, stepName) => {
      const line = await readLine();
      const code = parseInt(line.slice(0, 3), 10);
      const ok = Array.isArray(codes) ? codes.includes(code) : code === codes;
      if (!ok) throw new Error(`${stepName} 失败：${line.slice(0, 100)}`);
      return { code, line };
    };

    let write = (s) => { socket.write(s); };

    (async () => {
      try {
        // 先创建 socket 并立刻挂上监听（connect 之前），保证问候不丢
        const opts = { host, port };
        // SMTP_EXTRA_CA：仅供本地联调自建 SMTP 服务时使用（填自签证书路径）。
        // 正常使用 QQ/163/Gmail 等公共邮箱时**不要**设置，走系统受信任 CA。
        const extraCa = process.env.SMTP_EXTRA_CA;
        const tlsOpts = { servername: net.isIP(host) ? undefined : host };
        if (extraCa && require('fs').existsSync(extraCa)) {
          tlsOpts.ca = [require('fs').readFileSync(extraCa)];
          tlsOpts.checkServerIdentity = () => undefined; // 自签证书下跳过 CN/SAN 校验
        }
        socket = useSSL
          ? tls.connect(Object.assign({}, opts, tlsOpts))
          : net.connect(opts);
        socket.setTimeout(30000);
        socket.on('data', onData);
        socket.on('timeout', () => finish({ ok: false, error: 'socket_timeout' }));
        socket.on('error', (e) => finish({ ok: false, error: 'socket: ' + e.message }));

        // 等待连接建立：TLS 等 secureConnect，明文等 connect
        await new Promise((res, rej) => {
          if (!socket.connecting) return res();
          const evName = useSSL ? 'secureConnect' : 'connect';
          const onErr = (e) => rej(e);
          socket.once(evName, () => { socket.removeListener('error', onErr); res(); });
          socket.once('error', onErr);
        });

        await expectCode(220, '连接问候');

        // EHLO
        write(`EHLO weibo-checkin\r\n`);
        const ehlo = await expectCode(250, 'EHLO');

        // 587 端口走 STARTTLS 升级（若服务器支持）
        if (!useSSL) {
          write('STARTTLS\r\n');
          const tlsResp = await expectCode([220, 500, 502, 454], 'STARTTLS');
          if (tlsResp.code === 220) {
            // 升级为 TLS：先摘掉旧的 data 监听，再用同一 socket 建 TLS
            socket.removeAllListeners('data');
            const raw = socket;
            const secured = tls.connect(Object.assign({ socket: raw }, tlsOpts));
            socket = secured;
            // 重置响应队列，重新挂监听
            lineQueue = [];
            waiting = null;
            replyBuf = '';
            secured.on('data', onData);
            secured.on('error', (e) => finish({ ok: false, error: 'tls: ' + e.message }));
            await new Promise((res, rej) => {
              secured.once('secureConnect', res);
              secured.once('error', rej);
            });
            write(`EHLO weibo-checkin\r\n`);
            await expectCode(250, 'STARTTLS 后 EHLO');
          }
        }

        // AUTH LOGIN
        write('AUTH LOGIN\r\n');
        await expectCode(334, 'AUTH LOGIN');
        write(Buffer.from(user).toString('base64') + '\r\n');
        await expectCode(334, '用户名');
        write(Buffer.from(pass).toString('base64') + '\r\n');
        await expectCode(235, '密码认证');

        // MAIL FROM / RCPT TO
        write(`MAIL FROM:<${user}>\r\n`);
        await expectCode(250, 'MAIL FROM');
        for (const addr of to) {
          write(`RCPT TO:<${addr}>\r\n`);
          await expectCode([250, 251], `RCPT TO ${addr}`);
        }

        // DATA
        write('DATA\r\n');
        await expectCode(354, 'DATA');
        // 正文中若出现单独一行 "."，需要转义为 ".."
        const safeBody = message.replace(/\r\n\.\r\n/g, '\r\n..\r\n');
        write(safeBody + '\r\n.\r\n');
        await expectCode(250, '发送正文');

        write('QUIT\r\n');
        finish({ ok: true });
      } catch (e) {
        finish({ ok: false, error: String((e && e.message) || e) });
      }
    })();
  });
}

/** 便捷：发一封中文通知邮件，失败只打日志不抛错 */
async function notify(subject, text, html) {
  if (!mailConfigured()) {
    console.log(`[mail] 未配置 SMTP，跳过发信。内容预览：${subject}`);
    return { ok: false, error: 'smtp_not_configured' };
  }
  const r = await sendMail({ subject, text, html });
  if (r.ok) {
    console.log(`[mail] ✅ 已发送：${subject} → ${recipients().join(', ')}`);
  } else {
    console.log(`[mail] ❌ 发送失败：${r.error}（不影响签到结果）`);
  }
  return r;
}

module.exports = { sendMail, notify, mailConfigured, recipients };

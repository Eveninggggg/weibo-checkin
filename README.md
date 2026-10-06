# 微博超话签到 · 云端版（GitHub Actions 免费方案）

> 7×24 自动签到，**不依赖你的电脑开机**。用 GitHub Actions 免费额度运行，
> 每天在指定时间窗内随机时刻，用真实浏览器页面上下文完成签到（绕过微博风控）。
> 内置**邮件通知**：签到结果 + Cookie 到期倒计时，Cookie 快过期时提前提醒你重抓。

> **版本声明**
> - 制作人：**乐子人**
> - 性质：**个人学习作品**（学习 Node + Playwright + GitHub Actions 之用）
> - **仅供学习自用，不可用于任何盈利目的**；请勿用于刷量等干扰微博正常服务的行为
> - 与微博（新浪）官方无任何关联，Cookie 均来自使用者本人登录态

---

## 一、它能做什么

- ✅ **完全免费**：GitHub Actions 公共仓库无限量，私有仓库每月 2000 分钟（我们每天只消耗约 2~3 分钟）
- ✅ **不依赖电脑**：云端运行，电脑关机也照常签到
- ✅ **随机窗口**：定时触发后在 0~15 分钟内随机执行，降低机器特征
- ✅ **账号间随机间隔**：账号之间随机等待 30~48 秒，避免 22 个账号同一秒连续签到
- ✅ **外部准点触发**：可选接 cron-job.org，绕开 GitHub 调度延迟
- ✅ **多账号**：支持任意数量账号
- ✅ **关键词白名单**：只签你关心的超话（可选）
- ✅ **邮件通知**：把签到结果、失败明细、**Cookie 剩余天数表**发到你邮箱
- ✅ **Cookie 到期预警**：快过期时邮件提前提醒，不用天天惦记

## 二、准备工作

1. 一个 **GitHub 账号**（[注册](https://github.com/signup)，免费）
2. 各账号的 **微博 Cookie**（抓取方法见第五节）
3. （可选，想收邮件才需要）**一个邮箱**，并开启它的 SMTP 服务拿到授权码
4. 电脑上装了 **Node.js 18+**（仅本地自检用，可选）

---

## 三、部署步骤（约 10 分钟）

### 第 1 步：创建仓库

1. 登录 GitHub，点右上角 **+** → **New repository**
2. 仓库名填 `weibo-checkin`（随意）
3. **建议选 Private（私有）**，因为要存 Cookie
4. 点 **Create repository**

### 第 2 步：上传代码

把本目录（`weibo-checkin-cloud`）下的**所有文件**上传到仓库：

**方式 A：网页上传（最简单）**
1. 进入刚建的仓库，点 **Add file** → **Upload files**
2. 把 `index.js`、`checkin.js`、`package.json`、`.gitignore` 拖进去
3. 再手动创建 `.github/workflows/checkin.yml`：
   - 点 **Add file** → **Create new file**
   - 文件名输入 `.github/workflows/checkin.yml`
   - 粘贴 `checkin.yml` 的内容
4. 点 **Commit changes**

> ⚠️ **注意**：`.github/workflows/checkin.yml` 必须放在这个确切路径，Actions 才会识别。

**方式 B：命令行（熟悉 git 的话）**
```bash
cd weibo-checkin-cloud
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/weibo-checkin.git
git push -u origin main
```

### 第 3 步：配置 Cookie（Secrets）

1. 进入仓库 → **Settings** → 左侧 **Secrets and variables** → **Actions**
2. 点 **New repository secret**
3. **Name** 填 `WEIBO_ACCOUNTS`，**Secret** 填账号 JSON（格式见下）
4. 点 **Add secret**

**`WEIBO_ACCOUNTS` 的格式**（JSON 数组）：

```json
[
  {"name":"兔","cookie":"WEIBOCN_FROM=1110006030; _T_WM=xxx; SCF=xxx; SUB=xxx; ..."},
  {"name":"不知道","cookie":"WEIBOCN_FROM=1110006030; _T_WM=yyy; SCF=yyy; SUB=yyy; ..."}
]
```

> 💡 **重要**：粘贴进 Secret 时必须是**一行**（GitHub 输入框会自动处理换行，但 JSON 本身要合法）。建议先在文本编辑器里把 JSON 压缩成一行再粘贴。

**可选**：再加一个 `WEIBO_KEYWORDS` secret，值为逗号分隔的关键词（如 `梓渝,许嵩`），留空则签到全部超话。

### 第 3.5 步：配置邮件通知（可选，但强烈建议）

不配也能跑，只是没有任何通知；配了之后每天能收到一份「签到结果 + Cookie 倒计时」邮件。

需要加这几个 Secret（都在同一页面 `New repository secret`）：

| Secret 名 | 必填 | 填什么 | 例子 |
|---|---|---|---|
| `SMTP_HOST` | ✅ | 发件邮箱的 SMTP 服务器 | `smtp.qq.com` / `smtp.163.com` / `smtp.126.com` |
| `SMTP_PORT` | ⭕ | 端口，留空默认 465 | `465`（SSL）或 `587`（STARTTLS） |
| `SMTP_USER` | ✅ | 发件邮箱地址 | `yourname@qq.com` |
| `SMTP_PASS` | ✅ | **SMTP 授权码**（不是登录密码！） | `abcdefghijklmnop` |
| `ALERT_TO` | ⭕ | 收件邮箱，多个用英文逗号隔开；留空=发给自己 | `me@163.com,me@gmail.com` |
| `MAIL_ALWAYS` | ⭕ | 填 `0` = 只有异常/预警才发；留空 = 每天都发 | `0` |
| `COOKIE_WARN_DAYS` | ⭕ | 提前几天开始提醒 Cookie 到期，留空 = 7 | `5` |

**怎么拿 SMTP 授权码？**

- **QQ 邮箱**：设置 → 账户 → 找到「IMAP/SMTP服务」→ 开启 → 按提示发短信 → 得到一串 16 位授权码
- **163 / 126 邮箱**：设置 → POP3/SMTP/IMAP → 开启 SMTP 服务 → 设置客户端授权密码
- **Gmail**：需要开启两步验证后生成「应用专用密码」，且 `SMTP_HOST=smtp.gmail.com`、`SMTP_PORT=465`

> ⚠️ 授权码只在开启时显示一次，记得先复制下来。它和你邮箱登录密码是两回事，泄露了要立刻重置。

**配好之后你会收到什么？**

| 情况 | 邮件标题 | 内容 |
|---|---|---|
| Cookie 失效 | `❌ 3 个账号 Cookie 已失效，需重新抓取` | 列出失效账号 + 重抓步骤 |
| 3 天内到期 | `⚠️ 2 个账号 Cookie 3 天内到期，尽快重抓` | 橙色高亮块 + 重抓步骤 |
| 7 天内到期 | `⏳ 5 个账号 Cookie 7 天内到期` | 黄色提醒块 |
| 有超话签到失败 | `❌ 有超话签到失败，请查看` | 失败明细 |
| 一切正常 | `✅ 全部成功 新签 12` | 账号结果表 + **Cookie 倒计时表** |

邮件正文里会有一张**每个账号的剩余天数表**，跟在插件里看到的效果一样：

```
备注名     剩余天数        状态          到期时间(北京)
----------------------------------------------------------
一号      29.4 天      ✅ 正常        2026-11-02 22:17
二号       5.2 天      ⚠️ 注意        2026-10-09 22:27
三号       1.8 天      🔴 紧急        2026-10-06 22:29
```

> 💡 **不太想天天收到邮件**？把 `MAIL_ALWAYS` 设成 `0`，就只在「有失败 / 有 Cookie 快到期 / Cookie 失效」时才发。

### 第 4 步：开启 Actions 权限

1. 仓库 → **Settings** → **Actions** → **General**
2. 找到 **Workflow permissions**
3. 选 **Read and write permissions** → **Save**

### 第 5 步：手动测试一次

1. 进入仓库 → **Actions** 标签
2. 左侧点 **微博超话签到**
3. 右侧点 **Run workflow** → 下拉里 `cookie_only` 保持 `false` → **Run workflow**
4. 等 1~3 分钟，点进去看日志：
   - 看到 `身份校验通过 uid=xxx` 就是成功
   - 看到 `✅ 签到成功` 说明完整链路通了
   - 看到 `[mail] ✅ 已发送：...` 说明邮件也通了

> 💡 **关于「随机等待」这一步：**
> - 手动触发时，等待上限取输入框 `max_wait_minutes`（**默认 0，点了就跑，不等待**）。
> - GitHub 定时触发时，等待上限 **15 分钟**（可用 Secret `WEIBO_MAX_WAIT_MINUTES` 改）。
> - 外部触发（cron-job.org）时，等待上限 **5 分钟**（可用 Secret `WEIBO_MAX_WAIT_MINUTES_EXTERNAL` 改）。
> - 勾了 `cookie_only = true` 时完全跳过等待。
>
> 也就是说：**手动跑得快是正常的**，随机等待只在定时/外部触发里才生效。想亲眼验证它有没有生效，手动触发时把 `max_wait_minutes` 填 `1`，日志里会打印实际等了多少秒。

> 🕵️ **关于「防机器特征」的两个间隔（容易混淆，区分一下）：**
> - `WEIBO_TOPIC_GAP_MS`（默认 4000ms）＝ **一个账号内部**，签到完一个超话等一会儿再签下一个。
> - `WEIBO_ACCOUNT_GAP_MS`（默认 30000ms）＝ **账号与账号之间**，跑完一个账号等 30 秒再跑下一个，并附带 0~60% 随机抖动。**最后一个账号跑完不等待**。
>
> 后者是防风控的关键：22 个账号若在同一秒内连续签到，是极明显的脚本特征。加上它之后，整轮 22 账号大约需要 **10~17 分钟**（纯间隔时间，不含签到本身耗时）。

**想只体检 Cookie、不发签到请求？**

`Run workflow` 时把 `cookie_only` 选成 `true` 再运行。它会跳过浏览器下载，只读一遍 Cookie 的到期时间然后发体检邮件，几十秒就结束。适合「刚重抓完 Cookie、想确认一下倒计时对不对」。

### 第 6 步：调整执行时间（可选）

编辑 `.github/workflows/checkin.yml`，改 `cron`：

```yaml
on:
  schedule:
    - cron: '7 1 * * *'   # 01:07 UTC = 09:07 北京时间
```

> **换算**：北京时间 = UTC + 8
> - 想 08:00 北京时间执行 → `0 0 * * *`
> - 想 09:00 → `0 1 * * *`
> - 想 22:00 → `14 0 * * *`（22-8=14）
>
> **分钟位建议不要写 `0`**：整点是全网 cron 最拥挤的时刻，延迟和丢弃概率最高，错开几分钟更可靠。

改完提交即可。触发后随机等待 **15 分钟**以内的窗口（可用 Secret `WEIBO_MAX_WAIT_MINUTES` 调整）。

> 📌 默认配置里已经有 **3 个 cron**（北京 09:07 / 10:23 / 11:41）互为容错——因为 GitHub 的 schedule 是「尽力而为」，高负载时会延迟数小时甚至丢弃。详见文件顶部注释。

> 💡 **最可靠的做法**：配置外部准点触发（cron-job.org），绕开 GitHub 调度器。详见《[部署指南.md](../部署指南.md)》第三节和《[外部定时触发方案.md](../外部定时触发方案.md)》。

---

## 四、Cookie 抓取方法

> Cookie 有效期约 **30 天**，到期需重新抓取更新 Secrets。
> **不用自己记日子**——配了邮件通知后，脚本会在到期前自动提醒你。

**推荐：无痕窗口抓取（避免污染你日常浏览器的登录态）**

1. 打开 Chrome **无痕窗口**（Ctrl+Shift+N / ⌘+Shift+N）
2. 登录 [m.weibo.cn](https://m.weibo.cn)
3. 按 **F12** 打开开发者工具 → **Network（网络）** 标签
4. 刷新页面，点任意一个请求
5. 在 **Request Headers** 里找到 `Cookie:` 那一行
6. 右键 → **Copy value**，得到完整 Cookie 字符串
7. 关掉无痕窗口

> 💡 **一个账号一个无痕窗口**，抓完立刻关闭，避免后续登录其他账号把凭证顶掉。

---

## 五、本地自检（可选，强烈推荐先做）

在上云之前，先在本机验证脚本能跑通：

```bash
cd weibo-checkin-cloud
npm install
npx playwright install chromium

# 创建 accounts.json（本文件已被 .gitignore 排除，不会上传）
cat > accounts.json << 'EOF'
[
  {"name":"兔","cookie":"这里粘贴你的Cookie"}
]
EOF

# 干跑：只校验身份 + 拉列表，不签到（安全）
node index.js --dry-run

# 只看 Cookie 还剩几天（不发签到请求，也不需要浏览器）
node index.js --cookie-only

# 正式跑一次
node index.js
```

**本地想测试邮件发送**，先在 shell 里导出环境变量再跑：

```bash
export SMTP_HOST=smtp.qq.com
export SMTP_USER=yourname@qq.com
export SMTP_PASS=你的授权码
export ALERT_TO=收件邮箱
node index.js --cookie-only      # 只发体检邮件，适合验证 SMTP 配得对不对
```

---

## 六、成本与限制

| 项目 | 说明 |
|---|---|
| **费用** | ￥0（公共仓库无限量；私有仓库每月 2000 分钟，我们每天约用 2~3 分钟） |
| **定时精度** | GitHub cron 可能延迟几分钟到几十分钟（高峰期），配合随机窗口反而更自然 |
| **最短间隔** | Actions cron 最短 5 分钟，但我们每天一次，无影响 |
| **Cookie 过期** | 约 30 天，需手动更新 Secrets（脚本会提前邮件提醒） |
| **邮件服务** | 用你自己邮箱的 SMTP，不收钱；免费邮箱一般有每日发信上限（如 QQ 邮箱 50 封/天），我们每天 1 封，完全够 |
| **失败排查** | Actions 页面可查看每次运行的完整日志 |

---

## 七、常见问题

**Q：日志显示 `未找到任何账号`？**
A：检查 Secrets 名字是否为 `WEIBO_ACCOUNTS`，且 JSON 合法（可粘贴到 [json.cn](https://www.json.cn) 验证）。

**Q：日志显示 `登录态校验未通过`？**
A：Cookie 失效或被顶。重新按第四节抓取并更新 Secret。

**Q：签到失败 403 / errno 100015？**
A：本方案已用「页面上下文」（真实浏览器）发起请求，不应再出现。若出现请把日志发我。

**Q：邮件没收到 / 日志里报 `smtp_not_configured`？**
A：说明 `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` 没配全。三个都得填。

**Q：日志里报 `密码认证失败：535 ...`？**
A：多半是 `SMTP_PASS` 填成了邮箱登录密码。要去邮箱设置里开启 SMTP 服务，用生成的**授权码**。

**Q：邮件进了垃圾箱？**
A：把发件人加进白名单/通讯录即可。个人邮箱直连 SMTP 发信，被判定为营销邮件的概率不高但不为零。

**Q：`MAIL_ALWAYS=0` 是什么意思？**
A：只在这些情况才发信——有账号 Cookie 失效、有 Cookie 进入提醒窗口、有超话签到失败。一切正常的日子不打扰你。

**Q：Actions 页面出现 `Node.js 20 is deprecated ... actions/checkout@v4, actions/setup-node@v4` 警告？**
A：这是**提示**不是错误，工作流会照常跑完（GitHub 会自动用 Node 24 代跑这些 action）。本项目已升级到 `actions/checkout@v5` + `actions/setup-node@v5`，拉最新版即可消除。
> 注意：v5 的 setup-node 在 `package.json` 含 `packageManager` 字段时会自动开启缓存，可能重新触发「锁文件缺失」报错。本项目已显式写成 `package-manager-cache: false` 规避。

**Q：Actions 提示 `The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026`？**
A：纯告知性 notice，**不需要任何操作**。`ubuntu-latest` 标签届时会自动指向新系统，本项目的依赖（Node + Playwright）在新系统上同样可用。

**Q：Actions 报错 `Error: Dependencies lock file is not found ... Supported file patterns: package-lock.json, npm-shrinkwrap.json, yarn.lock`？**
A：这是 `actions/setup-node` 的 npm 缓存要求仓库里必须有 `package-lock.json` 导致的。两种解法任选其一：
- **解法一（本项目已默认采用）**：不开启 npm 缓存。本仓库的 `checkin.yml` 已显式关闭（`package-manager-cache: false`），直接拉最新版即可。
- **解法二（想启用缓存加速）**：确保仓库根目录有 `package-lock.json` 并一起提交。本项目已附带该文件，把它和其他文件一起上传到仓库，再把 `package-manager-cache` 改成 `true` 即可。

> 注意：报错日志里同时出现的 `DeprecationWarning: The punycode module is deprecated` 是 Node 20 的无害提示，与失败无关，可以忽略。

**Q：今天定时任务没自动跑 / 定时任务突然停了？**
A：按这个顺序排查（第 1 条是绝大多数情况的根因）：

1. **仓库 60 天无活动，定时被 GitHub 自动禁用了。** 打开 Actions → 点你的工作流 → 看页面顶部有没有黄色横幅（大意是 "disabled because there hasn't been activity in this repository for 60 days"）。**关键陷阱：定时任务自己运行不算"活动"，只有 commit/push 才算**，所以纯靠 cron 干活的仓库必然会在 60 天节点被关掉，而且**不发邮件、没有失败记录**。→ 点横幅旁的 **Enable workflow** 恢复。
   **本项目的解法**：已内置 `.github/workflows/keepalive.yml`，每周自动提交一次空 commit 把计时器归零，**别删这个文件**。
2. **cron 改动的提交者身份有问题。** 定时任务绑定在「最后一次修改 cron 行的提交者」身上。如果那次提交来自 bot / 工作流自身（用 `GITHUB_TOKEN` 提交），可能导致 schedule 不注册。→ 用你自己的账号手动小改一下 cron 行再提交。
3. **定时本身是「尽力而为」，不保证准时。** 整点（`:00`）是全网最拥挤的时刻，延迟 5~20 分钟甚至被丢弃都可能。→ 本项目 cron 已改为 `7 1 * * *`（避开整点）。
4. **排查命令**：在工作流页面 URL 后面加 `?query=event%3Aschedule`，或点运行列表的 Filter 选 `event: schedule`。**一条记录都没有 = schedule 从未注册**；有记录但失败 = 另一类问题。
5. 其他：工作流文件必须在**默认分支**（main/master）上；fork 的仓库默认不跑定时，需在 Actions 页手动 Enable；`Settings → Actions → General` 里确认 Actions 没被禁用。

**Q：手动触发很快，是不是没生效？**
A：手动触发的随机等待上限默认是 `0`（输入框 `max_wait_minutes`），所以**点了就跑、不等待**，这是设计如此。只有定时触发（0~15 分钟）和外部触发（0~5 分钟）才会有随机等待。

**Q：Actions 没自动运行？**
A：参见上面第 1 条——GitHub 对长期无活动的仓库会暂停定时任务。进 Actions 页面点一次 **Enable** 即可。

**Q：能签多个账号吗？**
A：可以，`WEIBO_ACCOUNTS` 是个数组，加多少个都行。

---

## 八、文件说明

| 文件 | 作用 |
|---|---|
| `index.js` | 主入口：读环境变量、遍历账号、汇总结果、组装邮件 |
| `checkin.js` | 核心签到逻辑（Playwright 页面上下文 + sign 自救） |
| `cookie-age.js` | Cookie 到期分析：解析 `ALF`/`SSOLoginState`，算剩余天数、分档 |
| `mailer.js` | 零依赖 SMTP 发信（Node 内置 `net`/`tls`，支持 465/587） |
| `make-accounts.js` | 把账号原始文本转成 `WEIBO_ACCOUNTS` 用的 JSON |
| `package.json` | 依赖声明 |
| `package-lock.json` | 依赖版本锁定（启用 npm 缓存所需的锁文件） |
| `.github/workflows/checkin.yml` | GitHub Actions 定时工作流（签到主流程） |
| `.github/workflows/keepalive.yml` | 保活工作流：每周自动提交，防止定时任务被 GitHub 按「60 天无活动」规则禁用 |
| `.gitignore` | 防止 Cookie 等敏感文件被提交 |

---

## 九、Secret 一览表

| Secret 名 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `WEIBO_ACCOUNTS` | ✅ | — | 账号 JSON 数组（唯一真正必需的） |
| `WEIBO_KEYWORDS` | ⭕ | 空=全部 | 关键词白名单，逗号分隔 |
| `SMTP_HOST` | ⭕ | — | SMTP 服务器，填了才启用邮件 |
| `SMTP_PORT` | ⭕ | `465` | 465=SSL，587=STARTTLS |
| `SMTP_USER` | ⭕ | — | 发件邮箱 |
| `SMTP_PASS` | ⭕ | — | SMTP 授权码 |
| `ALERT_TO` | ⭕ | 同 `SMTP_USER` | 收件邮箱，逗号分隔可多个 |
| `MAIL_ALWAYS` | ⭕ | 每天都发 | 填 `0` = 仅异常/预警时发 |
| `COOKIE_WARN_DAYS` | ⭕ | `7` | 提前几天开始提醒 |
| `WEIBO_MAX_WAIT_MINUTES` | ⭕ | `15` | **GitHub 定时**触发时的随机等待上限（分钟），填 `0` = 不等待 |
| `WEIBO_MAX_WAIT_MINUTES_EXTERNAL` | ⭕ | `5` | **外部触发**（cron-job.org）时的随机等待上限（分钟） |
| `WEIBO_TOPIC_GAP_MS` | ⭕ | `4000` | 单个账号内，超话与超话之间的间隔（毫秒） |
| `WEIBO_ACCOUNT_GAP_MS` | ⭕ | `30000` | 账号与账号之间的间隔（毫秒）。模拟真人逐个操作，**降低机器特征的关键参数**，填 `0` = 关闭 |

> 还有一个 `ALERT_FROM_NAME`（邮件里显示的发件人名字），默认「微博签到助手」，一般不用改。

---

## 十、开发与测试

改代码后想验证邮件功能是否正常，可以跑测试套件（细节见 [`test/README.md`](test/README.md)）：

```bash
cd test

# 协议级测试：465 隐式 SSL 全链路 + 中文编解码（自带 mock 服务）
node run-test.js

# 587 STARTTLS 端到端（需要两个终端）
/usr/bin/python3 mock_smtp.py 587 starttls   # 终端 1
/usr/bin/python3 test_starttls.py            # 终端 2
```

测试会验证这些点，改完 mailer 记得跑一遍：

- 465 隐式 SSL 与 587 STARTTLS 两条 TLS 路径都能发出去
- 中文标题按 RFC2047 编码；**超长标题自动折行**（不折行会被服务器拒收）
- 正文 base64 每 76 字符折行（否则多账号倒计时表会触发 `500 Line too long`）
- `multipart/alternative` 同时带纯文本与 HTML 两版
- 未配置 SMTP 时静默降级，不影响签到

> `mailer.js` 里有个 `SMTP_EXTRA_CA` 环境变量，**仅供本地联调自建 SMTP 服务**用（填自签证书路径）。
> 用 QQ / 163 / Gmail 时不要设置它。


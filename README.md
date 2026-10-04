# 微博超话签到 · 云端版（GitHub Actions 免费方案）

> 7×24 自动签到，**不依赖你的电脑开机**。用 GitHub Actions 免费额度运行，
> 每天在指定时间窗内随机时刻，用真实浏览器页面上下文完成签到（绕过微博风控）。

---

## 一、它能做什么

- ✅ **完全免费**：GitHub Actions 公共仓库无限量，私有仓库每月 2000 分钟（我们每天只消耗约 2~3 分钟）
- ✅ **不依赖电脑**：云端运行，电脑关机也照常签到
- ✅ **随机窗口**：每天在「起始时间 + 0~60 分钟」内随机执行，降低机器特征
- ✅ **多账号**：支持任意数量账号
- ✅ **关键词白名单**：只签你关心的超话（可选）
- ✅ **失败通知**：有超话签到失败时，GitHub 会邮件通知你

## 二、准备工作

1. 一个 **GitHub 账号**（[注册](https://github.com/signup)，免费）
2. 各账号的 **微博 Cookie**（抓取方法见第六节）
3. 电脑上装了 **Node.js 18+**（仅本地自检用，可选）

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

### 第 4 步：开启 Actions 权限

1. 仓库 → **Settings** → **Actions** → **General**
2. 找到 **Workflow permissions**
3. 选 **Read and write permissions** → **Save**

### 第 5 步：手动测试一次

1. 进入仓库 → **Actions** 标签
2. 左侧点 **微博超话签到**
3. 右侧点 **Run workflow** → **Run workflow**
4. 等 1~3 分钟，点进去看日志：
   - 看到 `身份校验通过 uid=xxx` 就是成功
   - 看到 `✅ 签到成功` 说明完整链路通了

### 第 6 步：调整执行时间（可选）

编辑 `.github/workflows/checkin.yml`，改 `cron`：

```yaml
on:
  schedule:
    - cron: '0 1 * * *'   # 01:00 UTC = 09:00 北京时间
```

> **换算**：北京时间 = UTC + 8
> - 想 08:00 北京时间执行 → `0 0 * * *`
> - 想 09:00 → `0 1 * * *`
> - 想 22:00 → `14 0 * * *`（22-8=14）

改完提交即可。**窗口随机**已在工作流里内置（触发后随机等 0~60 分钟）。

---

## 四、Cookie 抓取方法

> Cookie 有效期约 **30 天**，到期需重新抓取更新 Secrets。

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
DRY_RUN=1 node index.js --dry-run

# 正式跑一次
node index.js
```

---

## 六、成本与限制

| 项目 | 说明 |
|---|---|
| **费用** | ￥0（公共仓库无限量；私有仓库每月 2000 分钟，我们每天约用 2~3 分钟） |
| **定时精度** | GitHub cron 可能延迟几分钟到几十分钟（高峰期），配合随机窗口反而更自然 |
| **最短间隔** | Actions cron 最短 5 分钟，但我们每天一次，无影响 |
| **Cookie 过期** | 约 30 天，需手动更新 Secrets |
| **失败排查** | Actions 页面可查看每次运行的完整日志 |

---

## 七、常见问题

**Q：日志显示 `未找到任何账号`？**
A：检查 Secrets 名字是否为 `WEIBO_ACCOUNTS`，且 JSON 合法（可粘贴到 [json.cn](https://www.json.cn) 验证）。

**Q：日志显示 `登录态校验未通过`？**
A：Cookie 失效或被顶。重新按第四节抓取并更新 Secret。

**Q：签到失败 403 / errno 100015？**
A：本方案已用「页面上下文」（真实浏览器）发起请求，不应再出现。若出现请把日志发我。

**Q：Actions 没自动运行？**
A：GitHub 对长期无活动的仓库会暂停定时任务。进 Actions 页面点一次 **Enable** 即可；建议每月手动跑一次保持活跃。

**Q：能签多个账号吗？**
A：可以，`WEIBO_ACCOUNTS` 是个数组，加多少个都行。

---

## 八、文件说明

| 文件 | 作用 |
|---|---|
| `index.js` | 主入口：读环境变量、遍历账号、汇总结果 |
| `checkin.js` | 核心签到逻辑（Playwright 页面上下文 + sign 自救） |
| `package.json` | 依赖声明 |
| `.github/workflows/checkin.yml` | GitHub Actions 定时工作流 |
| `.gitignore` | 防止 Cookie 等敏感文件被提交 |

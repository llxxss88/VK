# 方案一：云服务 SDK 推流（腾讯云 TRTC）

## 概述

在现有 HTML 页面中引入腾讯云 TRTC Web SDK，通过 WebRTC 协议直接推送摄像头画面到腾讯云服务器，观众打开同一链接即可实时观看。延迟 < 1 秒，无需安装任何软件。

---

## 一、准备工作：开通 TRTC 服务

### 1. 注册腾讯云
打开 https://cloud.tencent.com ，注册并完成实名认证（个人即可）。

### 2. 开通 TRTC
- 进入控制台，搜索 "TRTC" 或 "实时音视频"
- 点击「立即开通」，选择「体验版」（免费，每月 10000 分钟）
- 开通后进入 TRTC 控制台

### 3. 创建应用
- 点击「创建应用」
- 应用名称随意填，比如 `vk-live`
- 创建完成后，记下 **SDKAppID**（一串数字）

### 4. 获取 SecretKey
- 在应用详情页，找到「快速上手」或「开发辅助」
- 复制 **SecretKey**（用于生成签名）

---

## 二、生成 UserSig（安全签名）

TRTC 要求进入房间时提供签名。开发阶段可以用控制台的签名生成工具，正式使用时写个脚本来生成。

### 开发阶段（临时方案）
- TRTC 控制台 → 左侧「开发辅助」→ 「UserSig 生成&校验」
- 输入一个 userId（比如 `anchor`），点击生成
- 把生成的 `userSig` 复制下来（有效期 7 天）
- **注意：此方法仅用于开发测试，不要用在正式环境**

### 正式方案：用 Node.js 脚本生成签名

创建 `server/genUserSig.js`：

```javascript
// 安装依赖: npm install express
// 启动: node genUserSig.js

const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');

const SDKAPPID = 1400000000;       // 替换为你的 SDKAppID
const SECRETKEY = 'your_secret';   // 替换为你的 SecretKey
const EXPIRE_TIME = 60 * 60 * 24 * 7; // 签名有效期: 7天

function base64url(str) {
    return str.replace(/\+/g, '*').replace(/\//g, '-').replace(/\=/g, '_');
}

function genUserSig(userId) {
    const current = Math.floor(Date.now() / 1000);
    const sigDoc = JSON.stringify({
        'TLS.ver': '2.0',
        'TLS.identifier': userId,
        'TLS.sdkappid': SDKAPPID,
        'TLS.expire': EXPIRE_TIME,
        'TLS.time': current,
    });

    const compressed = zlib.deflateSync(Buffer.from(sigDoc));
    const b64Compressed = base64url(compressed.toString('base64'));

    const rawSig = `TLS.sig_api.${SDKAPPID}.${b64Compressed}`;
    const hmac = crypto.createHmac('sha256', SECRETKEY).update(rawSig).digest();
    const b64Hmac = base64url(hmac.toString('base64'));

    return `${rawSig}.${b64Hmac}`;
}

const app = express();

// CORS 允许页面跨域请求签名
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

// 签名接口
app.get('/sig', (req, res) => {
    const userId = req.query.userId || 'user_' + Date.now();
    res.json({ userId, userSig: genUserSig(userId), sdkAppId: SDKAPPID });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`签名服务: http://localhost:${PORT}/sig`));
```

---

## 三、改造现有页面

### 需要修改的文件结构

```
zhibo/
├── index.html          ← 修改：集成 TRTC SDK
├── trtc/
│   └── trtc.js         ← 下载或 CDN 引入 TRTC SDK
└── ...
```

### 修改 index.html

在 `<head>` 中引入 TRTC SDK：

```html
<script src="https://web.sdk.qcloudtrtc.com/5.x/trtc.min.js"></script>
```

修改 JS 核心逻辑（替换现有的 `startCamera` 相关代码）：

```javascript
// ========================================
// TRTC 直播核心逻辑
// ========================================

const SDKAPPID = 1400000000;  // 你的 SDKAppID
const ROOM_ID = 666666;       // 房间号（你自定义，数字即可）

let trtcClient = null;
let isAnchor = false;   // true = 主播(推流), false = 观众(拉流)

// 从签名服务器获取 userSig
async function fetchUserSig(userId) {
    // 开发阶段：直接返回控制台生成的临时签名
    // 正式阶段：改为请求你的签名服务器
    // return fetch(`http://localhost:3000/sig?userId=${userId}`).then(r => r.json());

    // 临时方案：直接用控制台复制的签名（仅开发用！）
    return {
        userId: userId,
        userSig: '你的临时userSig',
        sdkAppId: SDKAPPID
    };
}

// 初始化 TRTC
async function initTRTC(asAnchor) {
    isAnchor = asAnchor;

    const userId = asAnchor ? 'anchor_' + Date.now() : 'viewer_' + Date.now();
    const { userSig } = await fetchUserSig(userId);

    trtcClient = TRTC.create();

    // 监听远端流（观众端用）
    trtcClient.on('remote-video-available', ({ userId, streamType }) => {
        const view = 'remote-video';
        trtcClient.startRemoteVideo({ userId, streamType, view });
    });

    trtcClient.on('remote-video-unavailable', ({ userId }) => {
        trtcClient.stopRemoteVideo({ userId });
    });

    // 监听连接状态
    trtcClient.on('connection-state-changed', ({ state }) => {
        const statusMap = {
            'DISCONNECTED': '连接已断开',
            'CONNECTING': '连接中...',
            'CONNECTED': '已连接',
            'RECONNECTING': '重连中...'
        };
        document.getElementById('connectionStatus').textContent =
            statusMap[state] || state;
    });

    // 进房
    try {
        await trtcClient.enterRoom({
            roomId: ROOM_ID,
            sdkAppId: SDKAPPID,
            userId: userId,
            userSig: userSig,
            scene: 'live'
        });
        console.log('进房成功');
    } catch (error) {
        console.error('进房失败:', error);
        alert('进入房间失败: ' + error.message);
        return;
    }

    if (asAnchor) {
        // === 主播：推流 ===
        await trtcClient.startLocalVideo({
            view: document.getElementById('localVideo'),
            option: {
                mirror: true,          // 镜像
                profile: '720p'        // 分辨率: 480p / 720p / 1080p
            }
        });
        await trtcClient.startLocalAudio();
        console.log('推流开始');
    }
}

// 停止直播
async function stopTRTC() {
    if (trtcClient) {
        if (isAnchor) {
            await trtcClient.stopLocalVideo();
            await trtcClient.stopLocalAudio();
        }
        await trtcClient.exitRoom();
        trtcClient.destroy();
        trtcClient = null;
    }
}

// 修改页面上的按钮行为
// "开始直播" 按钮 → 调用 initTRTC(true)
// "观看直播" 按钮 → 调用 initTRTC(false)
// "结束直播" 按钮 → 调用 stopTRTC()
```

### 页面 UI 改动建议

在页面上加两个入口：

```html
<div id="roleSelector" style="display:flex; gap:20px; justify-content:center; padding:20px;">
    <button class="btn-primary" onclick="initTRTC(true)">
        📡 开始直播（主播）
    </button>
    <button class="btn-primary" onclick="initTRTC(false)">
        👁 观看直播（观众）
    </button>
</div>
<div id="connectionStatus" style="text-align:center; color:#888; font-size:12px;"></div>
```

---

## 四、部署发布

### 1. 部署页面到 Netlify
- 把整个 `zhibo/` 文件夹拖到 https://app.netlify.com 的部署区域
- 获得公网地址，如 `https://vk-live.netlify.app`

### 2. 部署签名服务（如有）
- 签名服务需要运行在一个有 Node.js 的环境
- 简单做法：用 Railway / Render 等免费服务部署 `genUserSig.js`
- 或者直接用 Vercel 部署为 Serverless Function

### 3. 使用流程
1. 主播打开页面 → 点击「开始直播」→ 授权摄像头 → 开始推流
2. 观众打开同一个链接 → 点击「观看直播」→ 自动播放主播画面
3. 主播放送完毕后点击「结束直播」

---

## 五、费用

| 项目 | 费用 |
|---|---|
| TRTC 体验版（1万分钟/月） | 免费 |
| Netlify 托管 | 免费 |
| 签名服务器 | 免费（Railway/Render 免费额度） |

**总计：个人使用完全免费。**

---

## 六、常见问题

**Q: 观众看不到画面？**
- 检查主播和观众是否进了同一个 roomId
- 检查 SDKAppID 和 userSig 是否正确
- 打开浏览器控制台看是否有错误

**Q: 延迟多少？**
- 同城 < 300ms，国内跨省 < 1 秒

**Q: 能支持多少人同时看？**
- TRTC 默认每个房间支持最多 10 万并发观众（需要按量付费）
- 体验版限制：每个房间最多 100 人

**Q: 怎么在手机上用？**
- 页面部署到公网后，直接发给链接，手机浏览器打开即可
- 支持摄像头和麦克风权限授权

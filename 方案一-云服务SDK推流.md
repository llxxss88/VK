# 方案一：云服务 SDK 推流（火山引擎 RTC）

## 概述

在现有 HTML 页面中引入火山引擎 Web RTC SDK，通过 WebRTC 协议直接推送摄像头画面到火山引擎服务器，观众打开同一链接即可实时观看。延迟 < 1 秒，无需安装任何软件。

---

## 一、准备工作：开通火山引擎 RTC 服务

### 1. 注册火山引擎
打开 https://www.volcengine.com ，注册并完成实名认证（个人即可）。

### 2. 开通 RTC 服务
- 进入控制台首页，选择「实时音视频」
- 点击「领取礼包并开通」
- 开通后进入 RTC 控制台：https://console.volcengine.com/rtc/listRTC

### 3. 获取 AppId 和 AppKey
- 在「应用管理」页面，系统默认有一个 `defaultAppName` 应用
- 也可以点击「创建应用」新建，应用名称随意填，比如 `vk-live`
- 点击应用进入详情，记下：
  - **AppId**（一串数字）
  - **AppKey**（用于生成 Token，务必保密）

---

## 二、生成 Token（安全签名）

RTC 要求客户端进入房间时提供 Token。开发阶段可以用控制台生成临时 Token，正式使用时写个脚本来生成。

### 开发阶段（临时方案）
- RTC 控制台 → 左侧「开发辅助」→ 「临时 Token 生成」
- 输入 roomId（比如 `live-room-001`）和 userId（比如 `anchor`）
- 把生成的 `Token` 复制下来（有效期 7 天）
- **注意：此方法仅用于开发测试，不要用在正式环境**

### 正式方案：用 Node.js 脚本生成签名

火山引擎 Token 基于 HMAC-SHA256 算法生成。参考官方 Demo：https://github.com/volcengine/rtc-aigc-demo

创建 `server/genToken.js`：

```javascript
// 安装依赖: npm install express crypto-js
// 启动: node genToken.js

const express = require('express');
const crypto = require('crypto');

const APP_ID = '你的AppId';       // 替换为你的 AppId
const APP_KEY = '你的AppKey';     // 替换为你的 AppKey
const EXPIRE_SECONDS = 60 * 60 * 24 * 7; // Token 有效期: 7天

// 生成随机字符串
function randomString(length = 8) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// 生成火山引擎 RTC Token
function genToken(roomId, userId) {
    const now = Math.floor(Date.now() / 1000);
    const expire = now + EXPIRE_SECONDS;
    const sessionId = randomString(16);

    // Token 版本
    const version = '2.0';

    // 构建 Token payload
    const payload = JSON.stringify({
        'Version': version,
        'AppId': APP_ID,
        'RoomId': roomId,
        'UserId': userId,
        'IssuedAt': now,
        'ExpireAt': expire,
        'Nonce': randomString(8),
        'Privileges': {
            'PublishStream': expire,
            'SubscribeStream': expire,
            'PublishAudioCapture': expire,
            'SubscribeAudioCapture': expire,
            'PublishVideoCapture': expire,
            'SubscribeVideoCapture': expire,
        }
    });

    // Base64 URL-encode
    const b64Payload = Buffer.from(payload).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    // HMAC-SHA256 签名
    const signature = crypto
        .createHmac('sha256', APP_KEY)
        .update(b64Payload)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    return `${b64Payload}.${signature}`;
}

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

app.get('/token', (req, res) => {
    const roomId = req.query.roomId || 'live-room-001';
    const userId = req.query.userId || 'user_' + Date.now();
    const token = genToken(roomId, userId);
    res.json({ appId: APP_ID, roomId, userId, token });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Token 服务: http://localhost:${PORT}/token`));
```

> **注意**：Token 生成涉及 AppKey，必须在服务端完成，**绝不能**把 AppKey 写在前端代码里。上面的 Token 生成逻辑参考了火山引擎官方 Demo，开发测试阶段也可以直接用控制台生成的临时 Token。

---

## 三、改造现有页面

### CDN 引入 RTC SDK

在 `index.html` 的 `<head>` 中添加：

```html
<!-- 火山引擎 RTC Web SDK (CDN) -->
<script src="https://lf-unpkg.volccdn.com/obj/vcloudfe/sdk/@volcengine/rtc/4.66.29/1760341744913/index.min.js"></script>
```

> 推荐使用最新版本，可在此查询：https://www.volcengine.com/docs/6348/1564074

### 核心 JS 逻辑

替换现有的 `startCamera` 相关代码：

```javascript
// ========================================
// 火山引擎 RTC 直播核心逻辑
// ========================================

const APP_ID = '你的AppId';          // 替换为你的 AppId
const ROOM_ID = 'live-room-001';    // 房间号（你自定义）

let engine = null;
let isAnchor = false;   // true = 主播(推流), false = 观众(拉流)

// 从 Token 服务器获取 Token
async function fetchToken(userId) {
    // 开发阶段：直接返回控制台生成的临时 Token
    // 正式阶段：改为请求你的 Token 服务器
    // return fetch(`http://localhost:3000/token?roomId=${ROOM_ID}&userId=${userId}`).then(r => r.json());

    // 临时方案：直接用控制台复制的 Token（仅开发用！）
    return {
        appId: APP_ID,
        roomId: ROOM_ID,
        userId: userId,
        token: '你的临时Token'
    };
}

// 初始化 RTC
async function initRTC(asAnchor) {
    isAnchor = asAnchor;

    const userId = asAnchor ? 'anchor_' + Date.now() : 'viewer_' + Date.now();
    const { token } = await fetchToken(userId);

    // 创建引擎
    engine = VERTC.createEngine(APP_ID);

    // 监听远端流（观众端用）
    engine.on(VERTC.events.onUserPublishStream, async ({ userId, mediaType }) => {
        console.log(`远端用户 ${userId} 发布了流，类型: ${mediaType}`);
        // 设置远端播放器
        await engine.setRemoteVideoPlayer(
            VERTC.StreamIndex.STREAM_INDEX_MAIN,
            {
                userId: userId,
                renderDom: 'remoteVideo'  // 对应 div 的 id
            }
        );
    });

    // 监听远端用户停止发布
    engine.on(VERTC.events.onUserUnpublishStream, ({ userId }) => {
        console.log(`远端用户 ${userId} 停止发布`);
        engine.removeRemoteVideoPlayer(userId);
    });

    // 监听连接状态
    engine.on(VERTC.events.onConnectionStateChanged, ({ state }) => {
        const statusMap = {
            0: '连接已断开',
            1: '连接中...',
            2: '已连接',
            3: '重连中...'
        };
        document.getElementById('connectionStatus').textContent =
            statusMap[state] || '状态码: ' + state;
    });

    // 进房
    try {
        await engine.joinRoom(
            token,          // token
            ROOM_ID,        // roomId
            { userId: userId },
            {
                isAutoPublish: true,          // 自动发布（主播需要）
                isAutoSubscribeAudio: true,   // 自动订阅远端音频
                isAutoSubscribeVideo: true,   // 自动订阅远端视频
            }
        );
        console.log('进房成功');
    } catch (error) {
        console.error('进房失败:', error);
        alert('进入房间失败: ' + error.message);
        return;
    }

    if (asAnchor) {
        // === 主播：开启摄像头和麦克风 ===
        await engine.startAudioCapture();
        await engine.startVideoCapture();

        // 设置本地画面
        engine.setLocalVideoPlayer(
            VERTC.StreamIndex.STREAM_INDEX_MAIN,
            { renderDom: 'localVideo' }
        );

        // isAutoPublish: true 会自动推流，无需手动调用 publishStream
        console.log('推流中...');
    }
}

// 停止直播
async function stopRTC() {
    if (engine) {
        if (isAnchor) {
            engine.stopAudioCapture();
            engine.stopVideoCapture();
        }
        await engine.leaveRoom();
        VERTC.destroyEngine(engine);
        engine = null;
    }
}
```

---

## 四、页面 UI 改动

在你的页面中已有的 `#localVideo` 视频元素之外，给观众端加一个远端视频容器，以及角色选择按钮和状态显示：

```html
<!-- 远端视频（观众端显示） -->
<div id="remoteVideo" style="display:none; position:absolute; ..."></div>

<!-- 角色选择 -->
<div style="display:flex; gap:20px; justify-content:center; padding:20px;">
    <button onclick="initRTC(true)" style="...">
        开始直播（主播）
    </button>
    <button onclick="initRTC(false)" style="...">
        观看直播（观众）
    </button>
    <button onclick="stopRTC()" style="...">
        结束直播
    </button>
</div>
<div id="connectionStatus" style="text-align:center; color:#888; font-size:12px;"></div>
```

---

## 五、部署发布

### 1. 部署页面到公网
把整个 `zhibo/` 文件夹部署到 Netlify / GitHub Pages / Cloudflare Pages：

**Netlify（最简单）：**
- 打开 https://app.netlify.com
- 把文件夹拖进去即可
- 获得公网地址，如 `https://vk-live.netlify.app`

### 2. 部署 Token 服务
Token 服务需要运行在有 Node.js 的环境：
- 简单做法：用 [Render](https://render.com) 或 [Railway](https://railway.app) 免费额度部署 `genToken.js`
- 或者用 Vercel Serverless Function 部署
- **开发测试阶段可以先用控制台临时 Token，跳过这一步**

### 3. 使用流程
1. 主播打开页面 → 点击「开始直播」→ 授权摄像头和麦克风 → 开始推流
2. 观众打开同一个链接 → 点击「观看直播」→ 自动播放主播画面
3. 主播点击「结束直播」结束

---

## 六、费用

| 项目 | 费用 |
|---|---|
| 火山引擎 RTC（1 万分钟/月） | **免费**（每个 AppId 自动赠送） |
| Netlify / GitHub Pages 托管 | 免费 |
| Token 服务器（Render/Railway） | 免费 |

**总计：个人使用完全免费。**

> 免费额度每月自动发放，当月未用完清零不累计。超出后按量计费。
> 详情：https://www.volcengine.com/docs/6348/1392585

---

## 七、常见问题

**Q: 观众看不到画面？**
- 检查主播和观众是否用了同一个 `ROOM_ID`
- 检查 AppId 和 Token 是否正确
- 观众端需要有一个 id 为 `remoteVideo` 的 div 容器来渲染远端画面
- 打开浏览器控制台看是否有错误

**Q: 延迟多少？**
- 同城 < 300ms，国内跨省 < 1 秒

**Q: 能支持多少人同时看？**
- 单个房间最多支持 10 万并发观众（需要按量付费）
- 免费额度内每个房间上限约 100 人

**Q: 怎么在手机上用？**
- 页面部署到公网后，直接发链接，手机浏览器打开即可
- iOS Safari 和 Android Chrome 均支持摄像头和麦克风权限授权

**Q: 火山引擎 vs 腾讯云 TRTC 选哪个？**
- 功能基本等同，延迟、免费额度都差不多
- 核心区别：火山引擎是字节跳动体系（和抖音同源技术栈），TRTC 是腾讯体系
- 如果你已有火山引擎/字节系账号，选火山引擎更方便；已有腾讯云账号就选 TRTC

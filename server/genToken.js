// 火山引擎 RTC 调试服务
// 启动: npm start
// Token: GET  http://localhost:3000/token?roomId=xxx&userId=xxx&role=anchor|viewer
// 日志: POST http://localhost:3000/log

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ========== 配置（不要提交到公开仓库） ==========
const APP_ID = '69fde5ffe192960176372176';
const APP_KEY = '4ad1641b16894b34962b1f686372eee4';
const EXPIRE_SECONDS = 60 * 60 * 24 * 7; // 7天

const LOG_FILE = path.join(__dirname, 'debug.log');

// ========== 权限常量（官方定义） ==========
const PrivPublishStream = 0;
const PrivPublishAudioStream = 1;
const PrivPublishVideoStream = 2;
const PrivPublishDataStream = 3;
const PrivSubscribeStream = 4;

// ========== 二进制打包函数（little-endian，对齐官方 Python SDK） ==========
function packUint16(x) {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(x, 0);
    return buf;
}

function packUint32(x) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(x, 0);
    return buf;
}

function packString(s) {
    const bytes = Buffer.from(s, 'utf-8');
    return Buffer.concat([packUint16(bytes.length), bytes]);
}

function packBytes(b) {
    return Buffer.concat([packUint16(b.length), b]);
}

function packMapUint32(m) {
    // 按 key 排序
    const keys = Object.keys(m).map(Number).sort((a, b) => a - b);
    const parts = [packUint16(keys.length)];
    for (const k of keys) {
        parts.push(packUint16(k));
        parts.push(packUint32(m[k]));
    }
    return Buffer.concat(parts);
}

function buildToken(appId, appKey, roomId, userId, privileges, expireAt) {
    const nonce = crypto.randomInt(1, 99999999);
    const issuedAt = Math.floor(Date.now() / 1000);

    const msg = Buffer.concat([
        packUint32(nonce),
        packUint32(issuedAt),
        packUint32(expireAt),
        packString(roomId),
        packString(userId),
        packMapUint32(privileges)
    ]);

    const signature = crypto.createHmac('sha256', appKey).update(msg).digest();
    const content = Buffer.concat([packBytes(msg), packBytes(signature)]);

    return '001' + appId + content.toString('base64');
}

// ========== 工具函数 ==========
function writeLog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
    console.log(msg);
}

// ========== HTTP 服务 ==========
const app = express();

app.use(express.json());

// 托管父目录的静态文件
const staticDir = path.resolve(__dirname, '..');
console.log('[静态文件] 托管目录:', staticDir);
app.use(express.static(staticDir));

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Token 生成（官方二进制格式：001 + AppId + base64(content)）
app.get('/token', (req, res) => {
    const roomId = req.query.roomId || 'vk-live-room-001';
    const userId = req.query.userId || 'user_' + Date.now();
    const role = req.query.role || 'viewer';

    const now = Math.floor(Date.now() / 1000);
    const expireAt = now + EXPIRE_SECONDS;

    const privileges = {};
    privileges[PrivSubscribeStream] = expireAt;
    if (role === 'anchor') {
        privileges[PrivPublishStream] = expireAt;
        // 官方逻辑：添加 PublishStream 时自动加上子权限
        privileges[PrivPublishAudioStream] = expireAt;
        privileges[PrivPublishVideoStream] = expireAt;
        privileges[PrivPublishDataStream] = expireAt;
    }

    const token = buildToken(APP_ID, APP_KEY, roomId, userId, privileges, expireAt);

    writeLog(`Token生成 | role=${role} | userId=${userId} | roomId=${roomId} | tokenLen=${token.length}`);

    res.json({ appId: APP_ID, roomId, userId, token });
});

// 日志接收端点
app.post('/log', (req, res) => {
    const { type, message, data } = req.body;
    const ts = new Date().toISOString();
    if (data) {
        writeLog(`[BROWSER][${type}] ${message} | data=${JSON.stringify(data).substring(0, 500)}`);
    } else {
        writeLog(`[BROWSER][${type}] ${message}`);
    }
    res.json({ ok: true });
});

// 清空日志
app.get('/clear-log', (req, res) => {
    fs.writeFileSync(LOG_FILE, '');
    writeLog('日志已清空');
    res.json({ ok: true });
});

app.get('/', (req, res) => {
    res.send('<h3>VK海外直播 调试服务已启动</h3><p>日志文件: server/debug.log</p>');
});

fs.writeFileSync(LOG_FILE, '');
writeLog('=== 调试服务启动 ===');
writeLog(`AppId: ${APP_ID}`);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    writeLog(`服务已启动: http://localhost:${PORT}`);
});

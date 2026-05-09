# 方案三：自建 nginx-rtmp 推流服务器

## 概述

购买一台云服务器，安装 Nginx + RTMP 模块作为流媒体服务器。用 OBS 推送摄像头画面到服务器，观众通过浏览器 + HLS 播放器观看。完全自主控制，不受平台限制。

---

## 一、购买服务器

### 推荐配置

| 项目 | 最低配置 | 推荐配置 |
|---|---|---|
| CPU | 1 核 | 2 核 |
| 内存 | 1 GB | 2 GB |
| 系统盘 | 40 GB | 60 GB |
| 带宽 | 3 Mbps | 5-10 Mbps |
| 系统 | Ubuntu 22.04 | Ubuntu 22.04 |

### 购买渠道
- 阿里云轻量应用服务器：约 50 元/月（2核2G，5Mbps）
- 腾讯云轻量应用服务器：约 50 元/月（2核2G，5Mbps）
- 建议选离自己近的地域（如上海/广州/北京）

> **带宽说明**：一个观众看 720p 约需 2-3 Mbps。5 Mbps 带宽理论同时服务 1-2 人。多人观看需要更大带宽或用 CDN。

---

## 二、配置服务器

### 1. 登录服务器

```bash
# 本地电脑用 SSH 登录
ssh root@你的服务器公网IP
```

### 2. 安装 Nginx + RTMP 模块

```bash
# 更新包列表
apt update

# 安装 nginx 和 rtmp 模块
apt install -y nginx libnginx-mod-rtmp

# 确认安装成功
nginx -v
```

### 3. 配置 nginx

编辑 `/etc/nginx/nginx.conf`：

```nginx
# RTMP 配置（加在文件末尾，events 和 http 块之外）
rtmp {
    server {
        listen 1935;              # RTMP 推流端口
        chunk_size 4096;

        application live {        # 推流名称，对应 rtmp://IP/live/你的密钥
            live on;
            record off;           # 不录制到硬盘

            # 转 HLS 格式，观众通过 HTTP 观看
            hls on;
            hls_path /var/www/hls/;
            hls_fragment 3s;      # 每个 .ts 分片 3 秒
            hls_playlist_length 30s;  # m3u8 保留最近 30 秒

            # 允许推流来源（可选，限制 IP）
            # allow publish 127.0.0.1;
            # allow publish 你的IP;
            # deny publish all;

            # 允许播放来源（可选）
            # allow play all;
        }
    }
}

# HTTP 配置（在 http 块内，server 块中加）
# 编辑 /etc/nginx/sites-available/default
```

编辑 `/etc/nginx/sites-available/default`，在 `server` 块中添加：

```nginx
server {
    listen 80;
    # 如果有域名改为你的域名，没有就用 IP
    server_name _;

    # ... 其他默认配置保持不变 ...

    # HLS 流播放目录
    location /hls {
        add_header 'Access-Control-Allow-Origin' '*';
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS';
        add_header 'Cache-Control' 'no-cache';

        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }

        root /var/www;
    }

    # 静态页面（可选，把直播间页面放在服务器上）
    location / {
        root /var/www/html;
        index index.html;
    }
}
```

### 4. 创建 HLS 目录并重启

```bash
mkdir -p /var/www/hls
chown www-data:www-data /var/www/hls

# 测试配置
nginx -t

# 重启 nginx
systemctl restart nginx
```

### 5. 开放防火墙端口

```bash
# 云服务器控制台 → 安全组 → 入方向 → 添加规则

# 需要开放的端口：
# 1935 (RTMP 推流)
# 80   (HTTP/HLS 播放)
# 443  (HTTPS，后续配置 SSL 需要)
```

**云厂商的安全组**和**服务器内部防火墙**都要开放：

```bash
# 服务器内防火墙（如果有）
ufw allow 1935/tcp
ufw allow 80/tcp
ufw allow 443/tcp
```

---

## 三、配置 HTTPS（重要）

手机浏览器通常要求 HTTPS 才能播放视频。使用 Let's Encrypt 免费证书。

```bash
# 安装 certbot
apt install -y certbot python3-certbot-nginx

# 如果有域名，自动获取证书
certbot --nginx -d 你的域名.com

# 如果没有域名，用自签名证书（仅测试用，浏览器会警告）
# openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
#   -keyout /etc/ssl/private/nginx-selfsigned.key \
#   -out /etc/ssl/certs/nginx-selfsigned.crt
```

> 如果没有域名，可以去 freenom.com 申请免费域名，或者在阿里云/腾讯云买个 .com 域名（约 50 元/年）。

---

## 四、推流（OBS 端）

### 1. 下载安装 OBS Studio
- 官网：https://obsproject.com
- 免费开源，支持 Windows/Mac/Linux

### 2. 配置 OBS

**添加视频源：**
- 点击「来源」→「+」→「视频采集设备」→ 选择你的摄像头
- 点击「来源」→「+」→「音频输入采集」→ 选择你的麦克风（如果需要）
- 调整画面大小和位置

**配置推流：**
- 点击「设置」→「推流」
- 服务：选择「自定义」
- 服务器：填入 `rtmp://你的服务器IP/live`
- 推流码：随意填，比如 `stream`（这个作为流标识，观众要用来构造播放地址）

**设置输出：**
- 点击「设置」→「输出」
- 输出模式：简单
- 视频比特率：2500 Kbps（根据带宽调整，建议不超过服务器带宽的 80%）
- 编码器：硬件（NVENC）或软件（x264）

**点击「开始推流」**，推流开始后服务器 `/var/www/hls/` 下会生成 `.m3u8` 和 `.ts` 文件。

---

## 五、观众观看

### 方案 A：在你的页面中嵌入 HLS 播放器

修改你的 `index.html`，添加播放器：

```html
<!-- 引入 hls.js，支持浏览器播放 HLS -->
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

<!-- 观众端视频容器 -->
<video id="livePlayer" controls autoplay playsinline style="width:100%;"></video>

<script>
const streamKey = 'stream';  // 对应 OBS 推流码
const serverHost = '你的服务器IP或域名';
const video = document.getElementById('livePlayer');

if (Hls.isSupported()) {
    const hls = new Hls();
    // 注意：必须是 HTTPS 地址
    hls.loadSource(`https://${serverHost}/hls/${streamKey}.m3u8`);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
    });
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // iPhone Safari 原生支持 HLS
    video.src = `https://${serverHost}/hls/${streamKey}.m3u8`;
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });
}
</script>
```

### 方案 B：直接用播放器打开
把以下地址发给观众，用 VLC 或浏览器直接打开：
```
https://你的服务器/hls/stream.m3u8
```

---

## 六、带宽计算

这是自建方案的关键瓶颈：

| 画质 | 单路码率 | 5M 服务器支持人数 | 10M 服务器支持人数 |
|---|---|---|---|
| 480p | 1 Mbps | 4-5 人 | 8-10 人 |
| 720p | 2.5 Mbps | 1-2 人 | 3-4 人 |
| 1080p | 5 Mbps | 1 人 | 1-2 人 |

**如果观众超过 10 人，自建方案不太现实**，云服务 + CDN 是更好的选择。

---

## 七、完整链路图

```
┌──────────────────┐
│   你的电脑        │
│  OBS 采集摄像头   │──RTMP──┐
│  192.168.x.x     │        │
└──────────────────┘        │
                            ▼
                ┌─────────────────────┐
                │   云服务器            │
                │   IP: 123.123.x.x   │
                │                     │
                │   nginx-rtmp        │
                │   :1935 接收推流     │
                │       ↓             │
                │   转成 HLS 分片      │
                │       ↓             │
                │   nginx-http        │
                │   :443 分发 HLS     │
                └─────────────────────┘
                            │
                    ┌───────┼───────┐
                    ▼       ▼       ▼
                观众1    观众2    观众3
               (浏览器  (浏览器  (VLC
                +hls.js) +hls.js) 播放器)
```

---

## 八、进阶优化

### 降低延迟
- 缩短 HLS 分片：`hls_fragment 2s; hls_playlist_length 6s;`（最低可到 3-5 秒延迟）
- 使用 HTTP-FLV 代替 HLS（需要前端用 flv.js），延迟可降到 1-2 秒
- 直接 RTMP 拉流（需要观众用 VLC，延迟 < 1 秒）

### 录制直播
在 nginx.conf 的 `application live` 块中加：
```nginx
record all;
record_path /var/www/recordings/;
record_unique on;
```

### 多码率自适应
用 ffmpeg 转出多个码率的流：
```bash
ffmpeg -i rtmp://localhost/live/stream \
  -c:v libx264 -b:v 2000k -s 1280x720 -c:a aac -f flv rtmp://localhost/live/stream_720p \
  -c:v libx264 -b:v 800k -s 854x480 -c:a aac -f flv rtmp://localhost/live/stream_480p
```

---

## 九、常见问题

**Q: OBS 推流一直连接失败？**
- 检查云服务器安全组是否开放 1935 端口
- 检查服务器防火墙：`ufw status`
- 检查 nginx 是否运行：`systemctl status nginx`
- 用 `telnet 服务器IP 1935` 测试端口可达性

**Q: 观众看视频卡顿？**
- 降低 OBS 推流码率
- 服务器带宽不足，减少同时在看的观众
- 检查服务器 CPU 是否打满：`top`

**Q: 手机浏览器播不了？**
- 必须使用 HTTPS（准备域名 + SSL 证书）
- Safari 支持原生 HLS，Android Chrome 需要 hls.js

**Q: 延迟很大（> 20 秒）？**
- 缩短 `hls_fragment` 和 `hls_playlist_length`
- 改用 HTTP-FLV + flv.js 方案

**Q: 服务器重启后直播断了？**
- 设置 nginx 开机自启：`systemctl enable nginx`
- HLS 分片在 `/var/www/hls/` 是临时的，nginx 重启会清空

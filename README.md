# ken-cctv

Dashboard tập trung camera, chạy trong LAN Hà Nội. Lõi là [go2rtc](https://github.com/AlexxIT/go2rtc). Xem kế hoạch ở [PLAN.md](PLAN.md).

## Production: k3s (ken-gitops)

Chạy trên k3s qua Argo CD. Manifest nằm ở repo `ken-gitops`, thư mục `kustomize/cctv/production`; README trong thư mục đó có các bước cần làm trước khi deploy.
- Push lên `master` (sửa `dashboard/`, `nginx/` hoặc `Dockerfile`) thì workflow [Release](.github/workflows/release.yml) build `ghcr.io/kenshin17/ken-cctv-dashboard`, sửa tag trong ken-gitops, rồi sync Argo CD.
- go2rtc chạy `hostNetwork` trên node `lenovo-m7q`. Secret camera và token Xiaomi nằm trong Kubernetes Secret `ken-cctv-secret`, **không** nằm trong repo này (repo public).
- Danh sách stream cho k3s nằm ở `ken-gitops/.../go2rtc.yaml`. Thêm camera thì sửa file đó và `dashboard/cameras.json`.

Docker Compose bên dưới dùng để chạy thử, hoặc chạy trên một máy Linux riêng không có k3s.

## Hai cách chạy

| | Máy | Lệnh | Xiaomi |
|---|---|---|---|
| **Production** | Linux trong LAN Hà Nội | `docker compose up -d` | ✅ (host network) |
| **Thử trên Mac** | macOS + Docker Desktop | `docker compose -f docker-compose.mac.yml up -d` | ❌ (NAT chặn UDP P2P) |

Camera Xiaomi dùng UDP P2P trong LAN. Docker Desktop trên Mac luôn đặt container sau NAT, kể cả khi dùng `--network host`, nên phản hồi từ camera bị rơi. Trên Linux, `network_mode: host` cho go2rtc nằm thẳng trên LAN.

## Triển khai lên máy Linux

**Phần cứng:** máy nào luôn bật và cắm dây LAN là được, ví dụ mini PC Intel N100, Raspberry Pi 4/5 (4 GB) hoặc NAS chạy Docker. go2rtc chỉ chuyển tiếp luồng, không transcode, nên rất nhẹ. Image hỗ trợ cả amd64 và arm64.

1. Cài Ubuntu Server 24.04, Debian 12 hoặc Raspberry Pi OS 64-bit. Đặt **IP tĩnh** cho máy này (DHCP reservation trên router).
2. Cài Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
   ```
   Đăng xuất rồi đăng nhập lại để quyền nhóm `docker` có hiệu lực.
3. Đưa code lên máy. Dùng `git clone` nếu repo có remote, hoặc copy từ Mac:
   ```bash
   rsync -av --exclude .git ken-cctv/ user@<ip-linux>:~/ken-cctv/
   ```
   `rsync` copy luôn `.env` và `go2rtc/go2rtc.yaml` (có token Xiaomi). Nếu dùng `git clone` thì phải copy hai file này riêng bằng `scp`, vì chúng không nằm trong git.
4. Trên máy Linux, sửa `.env`: đặt `HOST_LAN_IP` thành IP của máy Linux.
5. Khởi động:
   ```bash
   cd ~/ken-cctv && docker compose up -d
   ```
6. Mở `http://<ip-linux>:8080`.

**Firewall** (nếu bật `ufw`): mở 8080 (dashboard), 1984 (go2rtc UI) và 8555 tcp+udp (WebRTC) cho mạng LAN:
```bash
sudo ufw allow from 192.168.173.0/24 to any port 8080,1984 proto tcp && sudo ufw allow from 192.168.173.0/24 to any port 8555
```

**Cập nhật** sau khi sửa code trên Mac: chạy lại `rsync`, rồi trên Linux chạy `docker compose up -d`. Nếu chỉ sửa `dashboard/` thì tải lại trang là đủ.

- **Dashboard**: `http://<IP máy chạy Docker>:8080`. Lưới camera, bấm vào một ô để xem HD toàn màn hình (có chụp ảnh và bật tiếng).
- **go2rtc Web UI** (cấu hình, thêm Xiaomi, debug): `http://<IP máy chạy Docker>:1984`.

### Dashboard
- Danh sách camera nằm trong [dashboard/cameras.json](dashboard/cameras.json). Mỗi camera có:
  - `stream`: tên stream trong go2rtc, dùng khi xem toàn màn hình.
  - `sub` (tuỳ chọn): stream chất lượng thấp cho lưới, đỡ tốn băng thông.
- Camera có trong `cameras.json` nhưng chưa có stream trong `go2rtc.yaml` sẽ hiện là "chưa được thêm".
- Nếu camera lỗi, nguyên nhân hiện ngay trên ô, ví dụ `i/o timeout` (sai IP) hoặc `401` (sai mật khẩu).
- Sửa file trong `dashboard/` xong chỉ cần tải lại trang, không phải restart.

Muốn thử dashboard khi chưa có camera, thêm stream test này vào `go2rtc/go2rtc.yaml` và thêm một mục `demo` vào `cameras.json`:

```yaml
  demo:
    - exec:ffmpeg -hide_banner -re -f lavfi -i testsrc2=size=1280x720:rate=15 -c:v libx264 -preset ultrafast -tune zerolatency -g 30 -pix_fmt yuv420p -f rtsp {output}
```

### Tapo C200
1. Trong app Tapo: Camera > Cài đặt > Nâng cao > **Tài khoản camera**. Tạo user/pass (đây là tài khoản riêng của camera, không phải tài khoản TP-Link).
2. Điền `TAPO_IP`, `TAPO_USER`, `TAPO_PASS` vào `.env`, rồi chạy `docker compose restart`.
3. Trên Web UI, bấm `stream` ở dòng `tapo_c200`.

### EZTV
1. Bật RTSP trong app hoặc web của camera nếu có tuỳ chọn.
2. Điền `EZTV_RTSP_URL`. Nếu không lên hình, thử lần lượt các đường dẫn ghi trong `.env.example`.

### Xiaomi Hà Nội
1. Web UI > **Add** > **Xiaomi**. Đăng nhập tài khoản Mi Home, nhập mã xác minh/captcha nếu được hỏi, chọn đúng region.
2. Load camera và copy URL `xiaomi://...` vào mục `streams:` trong `go2rtc/go2rtc.yaml` với tên `xiaomi_hn`.
3. Chạy `docker compose restart`.

Sau khi đăng nhập, token Xiaomi được ghi vào `go2rtc/go2rtc.yaml`. File này đã nằm trong `.gitignore`, đừng commit nó.

### Xiaomi Thái Bình
go2rtc chỉ stream Xiaomi qua LAN nên không kéo trực tiếp được từ Hà Nội. Xem PLAN.md, mục "Rủi ro chính".

## Kiểm tra nhanh

```bash
curl -s localhost:1984/api/streams                         # danh sách stream
curl -s -o snap.jpg "localhost:1984/api/frame.jpeg?src=tapo_c200"   # chụp snapshot
docker compose logs -f go2rtc
```

## Ghi chú
- WebRTC dùng `HOST_LAN_IP` làm candidate. Nếu WebRTC không lên, player tự chuyển sang MSE qua cổng 8080/1984.
- Trên Mac nhớ thêm `-f docker-compose.mac.yml` cho mọi lệnh `docker compose` (`restart`, `logs`...).
- Cấu hình nginx nằm ở `nginx/default.conf.template`. Upstream go2rtc và cổng lấy từ biến môi trường trong file compose.

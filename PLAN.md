# ken-cctv — Plan

Dashboard tập trung camera, chạy trong LAN Hà Nội.

## Camera

| # | Camera | Vị trí | Truy cập | Nguồn trong hệ thống |
|---|--------|--------|----------|----------------------|
| 1 | Xiaomi | Hà Nội | Xiaomi cloud | `xiaomi://` (go2rtc) |
| 2 | Xiaomi | Thái Bình | Xiaomi cloud | cần node ở Thái Bình (xem Rủi ro) |
| 3 | EZTV | Hà Nội | RTSP (LAN) | `rtsp://` |
| 4 | Tapo C200 | Hà Nội | RTSP (LAN) | `rtsp://` |

Lưu ý: go2rtc chỉ dùng cloud Xiaomi để lấy key, còn video phải đi qua LAN. Vì vậy camera Thái Bình cần thêm một node tại chỗ (xem phần Rủi ro).

## Kiến trúc

```
Xiaomi HN ─┐
Xiaomi TB ─┼─ cloud ──┐
EZTV ──────┼─ RTSP ───┼─> go2rtc ──> Dashboard web (WebRTC/MSE/HLS)
Tapo C200 ─┘          │      └────> (tuỳ chọn) ghi hình / phát hiện chuyển động
                      └ Docker Compose trên 1 máy luôn bật trong LAN
```

- **go2rtc** là lõi. Nó nhận RTSP và Xiaomi cloud, rồi phát lại qua WebRTC/MSE với độ trễ thấp. Mỗi camera chỉ bị kéo một luồng, nhiều client xem cùng lúc không tốn thêm tải cho camera.
- **Dashboard**: web nhẹ (Vite + React hoặc HTML thuần) gồm lưới camera, bấm vào để phóng to, trạng thái online/offline, snapshot. Nhúng player của go2rtc hoặc dùng `video-stream.js`.
- **Ghi hình** (giai đoạn sau): ffmpeg ghi segment từ go2rtc, hoặc Frigate nếu cần phát hiện người/xe.
- **Truy cập từ xa** (tuỳ chọn, sau cùng): Tailscale, không mở port ra internet.

## Rủi ro chính: Xiaomi (đã kiểm tra docs go2rtc 1.9.15)

- Nguồn `xiaomi://` (có từ go2rtc v1.9.13) **chỉ lấy key mã hoá qua cloud, còn video vẫn đi qua LAN**: URL có dạng `xiaomi://<user>:<region>@<IP LAN camera>?did=..&model=..`.
  - **Xiaomi Hà Nội**: dùng được nếu model nằm trong `DEVICES.md` của go2rtc.
  - **Xiaomi Thái Bình**: go2rtc ở Hà Nội **không kéo trực tiếp được**. Giả định "kéo qua cloud" ở bản plan trước là sai.
- Phương án cho Thái Bình (khuyến nghị A):
  - **A.** Đặt 1 thiết bị nhỏ luôn bật ở Thái Bình (Raspberry Pi, mini PC, TV box chạy Linux) chạy go2rtc và Tailscale. go2rtc Hà Nội kéo `rtsp://<tb-node>:8554/xiaomi_tb` qua Tailscale. Không cần mở port.
  - **B.** Dùng Tailscale subnet router ở Thái Bình để go2rtc Hà Nội gọi thẳng IP LAN của camera. Gọn hơn nhưng chưa chắc giao thức P2P của Xiaomi chạy ổn qua route.
  - **C.** Bỏ camera Thái Bình khỏi dashboard, chỉ xem bằng app Mi Home.
- Việc cần làm: xác nhận model 2 camera Xiaomi (Mi Home > camera > Cài đặt > Thông tin thiết bị). Đối chiếu với https://github.com/AlexxIT/go2rtc/blob/master/internal/xiaomi/DEVICES.md.

## Quyết định: server chạy Linux, host network (2026-11-24)

- go2rtc trong Docker Desktop trên Mac **không** kết nối được Xiaomi Phòng khách (`chuangmi.camera.ipc019e`, TUTK qua UDP). Camera không trả lời qua NAT của Docker Desktop, kể cả khi dùng `--network host`.
- Cùng config đó, chạy go2rtc trực tiếp trên macOS thì xem được. Như vậy model camera được hỗ trợ, lỗi chỉ nằm ở lớp mạng của Docker.
- Production: máy Linux trong LAN Hà Nội, `network_mode: host` (`docker-compose.yml`). Mac chỉ dùng để thử camera RTSP (`docker-compose.mac.yml`).

## Các giai đoạn

1. **Spike (1 buổi)**: chạy go2rtc bằng Docker, thêm Tapo C200 và EZTV qua RTSP, xem được trên UI có sẵn của go2rtc. Thêm 1 camera Xiaomi để kiểm tra khả thi.
2. **Cấu hình**: `docker-compose.yml`, `go2rtc.yaml`, `.env` (credentials, đã `.gitignore`). Đặt IP tĩnh hoặc DHCP reservation cho Tapo và EZTV.
3. **Dashboard**: lưới 4 camera, fullscreen, trạng thái, snapshot, responsive cho điện thoại trong LAN.
4. **Ổn định**: tự restart, healthcheck, log, xử lý khi token Xiaomi hết hạn.
5. **Mở rộng**: ghi hình và xem lại, thông báo chuyển động, Tailscale để xem ngoài nhà.

## Cấu trúc thư mục dự kiến

```
ken-cctv/
├── docker-compose.yml
├── go2rtc/go2rtc.yaml
├── dashboard/          # web app
├── .env.example
├── .gitignore
├── PLAN.md
└── README.md
```

## Cần bạn xác nhận

1. Model chính xác của 2 camera Xiaomi, và camera nào có RTSP chính thức.
2. Máy chạy server: Mac này, mini PC, Raspberry Pi hay NAS? Máy cần luôn bật.
3. Có cần ghi hình/xem lại không, hay chỉ xem live?
4. Có cần xem từ ngoài LAN không? (Hiện bạn nói chỉ trong LAN.)
5. Muốn dashboard tự viết (Vite/React) hay dùng sẵn UI của go2rtc/Frigate?

## Ghi chú bảo mật

- Mật khẩu RTSP và tài khoản Xiaomi chỉ để trong `.env`, không commit.
- Không mở port camera hay go2rtc ra internet.

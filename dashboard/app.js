// Ken CCTV dashboard. go2rtc's player (video-rtc.js) is proxied by nginx at /video-rtc.js,
// and the API at /api, so everything is same-origin.
import { VideoRTC } from '/video-rtc.js';

const NO_SIGNAL_MS = 20000;

const STATE_TEXT = {
  connecting: 'Đang kết nối',
  live: 'Trực tiếp',
  error: 'Lỗi',
  off: 'Chưa cấu hình',
};

/**
 * Thin wrapper around go2rtc's VideoRTC: no native controls, muted autoplay,
 * and a `state` event so the tile can show live / connecting / error.
 */
class VideoPlayer extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.addEventListener('playing', () => this.setState('live'));
    this.video.addEventListener('resize', () => this.emit());
    this.watch();
  }

  onopen() {
    const modes = super.onopen();
    this.onmessage.player = (msg) => {
      if (msg.type === 'error') this.setState('error', msg.value);
      else if (['mse', 'hls', 'mp4', 'mjpeg'].includes(msg.type)) this.transport = msg.type;
    };
    return modes;
  }

  onpcvideo(video2) {
    super.onpcvideo(video2);
    if (this.pcState === WebSocket.OPEN) this.transport = 'webrtc';
    this.emit();
  }

  onclose() {
    const reconnecting = super.onclose();
    if (reconnecting && this.state === 'live') this.setState('connecting');
    return reconnecting;
  }

  // Flag "no signal" if nothing plays within NO_SIGNAL_MS of (re)connecting.
  watch() {
    clearTimeout(this.watchTID);
    this.watchTID = setTimeout(() => {
      if (this.state !== 'live' && this.isConnected) {
        this.setState('error', this.lastError || 'Không có tín hiệu');
      }
    }, NO_SIGNAL_MS);
  }

  setState(state, detail = '') {
    if (state === 'error') this.lastError = detail;
    if (state === 'connecting') this.watch();
    this.state = state;
    this.detail = detail;
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('state', { detail: {
      state: this.state || 'connecting',
      detail: this.detail || '',
      transport: this.transport || '',
      width: this.video?.videoWidth || 0,
      height: this.video?.videoHeight || 0,
    } }));
  }

  disconnectedCallback() {
    clearTimeout(this.watchTID);
    super.disconnectedCallback();
  }
}
customElements.define('video-player', VideoPlayer);

function createPlayer(stream) {
  const player = document.createElement('video-player');
  player.src = new URL(`/api/ws?src=${encodeURIComponent(stream)}`, location.href);
  return player;
}

// ---------- grid ----------
const grid = document.getElementById('grid');
const tpl = document.getElementById('tile-tpl');
const summary = document.getElementById('summary');
const tileStates = new Map();

function updateSummary() {
  const configured = [...tileStates.values()].filter((s) => s !== 'off');
  const live = configured.filter((s) => s === 'live').length;
  summary.textContent = configured.length
    ? `${live}/${configured.length} camera đang trực tiếp`
    : 'Chưa có camera nào được cấu hình';
}

function renderTile(cam, configured) {
  const tile = tpl.content.firstElementChild.cloneNode(true);
  tile.dataset.id = cam.id;
  tile.querySelector('.tile-name').textContent = cam.name;
  tile.querySelector('.tile-loc').textContent = cam.location || '';
  tile.setAttribute('aria-label', `${cam.name}${cam.location ? ', ' + cam.location : ''}`);

  const badgeText = tile.querySelector('.badge-text');
  const mode = tile.querySelector('.mode');
  const res = tile.querySelector('.tile-res');
  const msg = tile.querySelector('.tile-msg');

  const setTile = ({ state, detail, transport, width, height }) => {
    tile.dataset.state = state;
    badgeText.textContent = STATE_TEXT[state] || state;
    msg.textContent = state === 'error' ? detail || '' : '';
    mode.textContent = state === 'live' ? transport : '';
    res.textContent = state === 'live' && width ? `${width}×${height}` : '';
    tileStates.set(cam.id, state);
    updateSummary();
  };

  if (!configured) {
    tile.classList.add('is-empty');
    tile.removeAttribute('tabindex');
    const empty = tile.querySelector('.tile-empty');
    empty.hidden = false;
    empty.querySelector('.tile-empty-title').textContent = `${cam.name} chưa được thêm`;
    empty.querySelector('.tile-empty-hint').innerHTML =
      `Thêm stream <code>${cam.stream}</code> vào <code>go2rtc/go2rtc.yaml</code> rồi khởi động lại.`;
    tile.querySelector('.tile-overlay').style.display = 'none';
    setTile({ state: 'off' });
    grid.appendChild(tile);
    return;
  }

  const player = createPlayer(cam.sub || cam.stream);
  player.addEventListener('state', (e) => setTile(e.detail));
  tile.querySelector('.tile-media').appendChild(player);
  setTile({ state: 'connecting' });

  const open = () => openViewer(cam);
  tile.addEventListener('click', open);
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  grid.appendChild(tile);
}

// ---------- full-screen viewer ----------
const viewer = document.getElementById('viewer');
const viewerBody = document.getElementById('viewer-body');
const viewerTitle = document.getElementById('viewer-title');
const audioBtn = document.getElementById('viewer-audio');
let viewerCam = null;
let viewerPlayer = null;

function openViewer(cam) {
  viewerCam = cam;
  viewerTitle.textContent = `${cam.name}${cam.location ? ' · ' + cam.location : ''}`;
  viewerPlayer = createPlayer(cam.stream);
  viewerPlayer.background = true; // keep streaming even if the dialog loses visibility briefly
  viewerBody.replaceChildren(viewerPlayer);
  audioBtn.textContent = 'Bật tiếng';
  viewer.showModal();
}

function closeViewer() {
  if (viewerPlayer) {
    viewerPlayer.ondisconnect();
    viewerPlayer = null;
  }
  viewerBody.replaceChildren();
  viewerCam = null;
}

viewer.addEventListener('close', closeViewer);
document.getElementById('viewer-close').addEventListener('click', () => viewer.close());

audioBtn.addEventListener('click', () => {
  const video = viewerPlayer?.video;
  if (!video) return;
  video.muted = !video.muted;
  if (!video.muted) video.play().catch(() => {});
  audioBtn.textContent = video.muted ? 'Bật tiếng' : 'Tắt tiếng';
});

document.getElementById('viewer-snap').addEventListener('click', () => {
  if (!viewerCam) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = `/api/frame.jpeg?src=${encodeURIComponent(viewerCam.stream)}`;
  a.download = `${viewerCam.id}_${stamp}.jpg`;
  a.click();
});

// ---------- clock ----------
const clock = document.getElementById('clock');
const fmt = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const tick = () => { clock.textContent = fmt.format(new Date()); };
tick();
setInterval(tick, 1000);

// ---------- boot ----------
async function main() {
  const [cams, streams] = await Promise.all([
    fetch('cameras.json', { cache: 'no-store' }).then((r) => r.json()),
    fetch('/api/streams', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
  ]);

  grid.dataset.count = String(cams.length);
  for (const cam of cams) renderTile(cam, Boolean(streams[cam.stream]));
}

main().catch((err) => {
  grid.innerHTML = `<p class="tile-empty-hint">Không tải được cấu hình: ${err.message}</p>`;
});

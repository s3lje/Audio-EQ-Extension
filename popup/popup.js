const BANDS = [
    { freq: 60,    label: '60Hz'  },
    { freq: 170,   label: '170Hz' },
    { freq: 310,   label: '310Hz' },
    { freq: 600,   label: '600Hz' },
    { freq: 1000,  label: '1kHz'  },
    { freq: 3000,  label: '3kHz'  },
    { freq: 6000,  label: '6kHz'  },
    { freq: 12000, label: '12kHz' },
    { freq: 14000, label: '14kHz' },
    { freq: 16000, label: '16kHz' },
];

const MAX_GAIN = 12; // ±12 dB
let gains = new Array(BANDS.length).fill(0);
let bypassed = false;

const container = document.getElementById('eqContainer');

BANDS.forEach((band, i) => {
    const bandEl = document.createElement('div');
    bandEl.className = 'band';
    bandEl.innerHTML = `
    <div class="band-gain" id="gain-${i}">0 dB</div>
    <div class="slider-track" id="track-${i}">
      <div class="slider-fill" id="fill-${i}"></div>
      <div class="slider-thumb" id="thumb-${i}"></div>
    </div>
    <div class="band-label">${band.label}</div>
  `;
    container.appendChild(bandEl);

    // Drag handling
    const track = bandEl.querySelector(`#track-${i}`);
    let dragging = false;
    let startY, startGain;

    track.addEventListener('mousedown', (e) => {
        dragging = true;
        startY = e.clientY;
        startGain = gains[i];
        track.querySelector('.slider-thumb').classList.add('active');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;

        const delta = (startY - e.clientY) * 0.2;
        const newGain = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, startGain + delta));
        setGain(i, newGain);
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        track.querySelector('.slider-thumb').classList.remove('active');
        saveSettings();
    });

    // Double-click to reset band
    track.addEventListener('dblclick', () => {
        setGain(i, 0);
        saveSettings();
    });
});

function setGain(i, value) {
    gains[i] = value;
    updateSliderVisual(i);
    sendEQUpdate(i, bypassed ? 0 : value);
    drawCurve();
}

function updateSliderVisual(i) {
    const track = document.getElementById(`track-${i}`);
    const fill = document.getElementById(`fill-${i}`);
    const thumb = document.getElementById(`thumb-${i}`);
    const gainLabel = document.getElementById(`gain-${i}`);

    const trackH = track.clientHeight || 120;
    const pct = gains[i] / MAX_GAIN; // -1 to +1


    const topPct = 50 - (pct * 50); // 0% = top, 100% = bottom
    thumb.style.top = `calc(${topPct}% - 7px)`; // 7px = half thumb height
    thumb.style.bottom = 'auto';

    // Fill bar
    if (gains[i] >= 0) {
        fill.className = 'slider-fill positive';
        fill.style.height = `${(gains[i] / MAX_GAIN) * 50}%`;
    } else {
        fill.className = 'slider-fill negative';
        fill.style.height = `${(Math.abs(gains[i]) / MAX_GAIN) * 50}%`;
    }

    // Gain label
    const rounded = Math.round(gains[i] * 10) / 10;
    gainLabel.textContent = rounded === 0 ? '0 dB' : `${rounded > 0 ? '+' : ''}${rounded} dB`;
    gainLabel.style.color = gains[i] === 0 ? 'var(--text-muted)' : 'var(--blue)';
}

function sendEQUpdate(bandIndex, gain) {
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (!tabs[0]) return;
        browser.tabs.sendMessage(tabs[0].id, {
            type: 'EQ_UPDATE',
            bandIndex,
            gain
        }).catch(() => {}); // Ignore errors on pages without content script
    });
}

document.getElementById('bypassToggle').addEventListener('change', (e) => {
    bypassed = e.target.checked;

    BANDS.forEach((_, i) => sendEQUpdate(i, bypassed ? 0 : gains[i]));
    saveSettings();
});


document.getElementById('resetBtn').addEventListener('click', () => {
    gains.fill(0);
    BANDS.forEach((_, i) => {
        updateSliderVisual(i);
        sendEQUpdate(i, 0);
    });
    drawCurve();
    saveSettings();
});


const canvas = document.getElementById('eqCurve');
const ctx = canvas.getContext('2d');

function drawCurve() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Grid line at 0 dB
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Approximate curve by summing band influences
    // Map frequency (20Hz–20kHz) logarithmically to canvas X
    const freqToX = (f) => (Math.log10(f / 20) / Math.log10(20000 / 20)) * W;
    const gainToY = (g) => H / 2 - (g / MAX_GAIN) * (H / 2 - 6);

    // Sample the "curve" at N points
    const points = [];
    const N = W;
    for (let px = 0; px < N; px++) {
        const freq = 20 * Math.pow(10000, px / N); // 20Hz to 200kHz log
        let totalGain = 0;
        BANDS.forEach((band, i) => {
            // Gaussian-ish bell curve per band in log-freq space
            const logDist = Math.log10(freq / band.freq);
            const sigma = 0.35;
            totalGain += gains[i] * Math.exp(-(logDist * logDist) / (2 * sigma * sigma));
        });
        totalGain = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, totalGain));
        points.push({ x: px, y: gainToY(totalGain) });
    }

    // Draw fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(61, 142, 240, 0.3)');
    grad.addColorStop(1, 'rgba(61, 142, 240, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(W, H / 2);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = '#3d8ef0';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#3d8ef0';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    points.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.shadowBlur = 0;
}


function saveSettings() {
    browser.storage.local.set({ eqGains: gains, eqBypassed: bypassed });
}

function loadSettings() {
    browser.storage.local.get(['eqGains', 'eqBypassed']).then(result => {
        if (result.eqGains) {
            gains = result.eqGains;
            gains.forEach((_, i) => {
                updateSliderVisual(i);
                sendEQUpdate(i, bypassed ? 0 : gains[i]);
            });
        }
        if (result.eqBypassed !== undefined) {
            bypassed = result.eqBypassed;
            document.getElementById('bypassToggle').checked = bypassed;
        }
        drawCurve();
    });
}

loadSettings();
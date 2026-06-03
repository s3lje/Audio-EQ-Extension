/* global browser */
(function () {
    if (window.__browserEQInjected) return;
    window.__browserEQInjected = true;

    // ── Inject the EQ engine into the PAGE context ────────────────
    // Content scripts are sandboxed — they can't patch AudioContext.
    // A <script> tag injected into the DOM runs in the real page context.
    const script = document.createElement('script');
    script.textContent = `
(function () {
    if (window.__eqEngineRunning) return;
    window.__eqEngineRunning = true;

    const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    const managedContexts = new Map();

    function buildEQChain(ctx) {
        if (managedContexts.has(ctx)) return managedContexts.get(ctx);

        const filters = BANDS.map((freq, i) => {
            const f = ctx.createBiquadFilter();
            if (i === 0)                     f.type = 'lowshelf';
            else if (i === BANDS.length - 1) f.type = 'highshelf';
            else                             f.type = 'peaking';
            f.frequency.value = freq;
            f.gain.value = 0;
            f.Q.value = 1;
            return f;
        });

        for (let i = 0; i < filters.length - 1; i++) {
            filters[i].connect(filters[i + 1]);
        }
        filters[filters.length - 1].connect(ctx.destination);

        managedContexts.set(ctx, { filters });
        return managedContexts.get(ctx);
    }

    // Patch AudioContext — this now runs in page context so it works
    const OrigAC = window.AudioContext || window.webkitAudioContext;

    const origCreateMES = OrigAC.prototype.createMediaElementSource;
    OrigAC.prototype.createMediaElementSource = function (element) {
        const source = origCreateMES.call(this, element);
        const chain = buildEQChain(this);
        try { source.disconnect(); } catch(e) {}
        source.connect(chain.filters[0]);
        return source;
    };

    const OrigACConstructor = window.AudioContext;
    window.AudioContext = function(...args) {
        const ctx = new OrigACConstructor(...args);
        buildEQChain(ctx);
        return ctx;
    };
    Object.setPrototypeOf(window.AudioContext, OrigACConstructor);
    window.AudioContext.prototype = OrigACConstructor.prototype;
    if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;

    // Hook plain <audio>/<video> elements that bypass Web Audio API
    function hookMediaElement(el) {
        if (el.__eqHooked) return;
        el.__eqHooked = true;
        try {
            const ctx = new OrigACConstructor();
            buildEQChain(ctx);
            const source = origCreateMES.call(ctx, el);
            try { source.disconnect(); } catch(e) {}
            source.connect(managedContexts.get(ctx).filters[0]);
        } catch(e) {
            // Element may already be attached to another context; that's fine
        }
    }

    document.querySelectorAll('audio, video').forEach(hookMediaElement);

    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches('audio, video')) hookMediaElement(node);
                node.querySelectorAll('audio, video').forEach(hookMediaElement);
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Apply gain to all managed contexts
    function applyGain(bandIndex, gain) {
        managedContexts.forEach(({ filters }) => {
            const f = filters[bandIndex];
            if (!f) return;
            f.gain.setTargetAtTime(gain, f.context.currentTime, 0.01);
        });
    }

    // Listen for messages from the content script bridge
    window.addEventListener('message', (e) => {
        if (!e.data || e.data.source !== 'browser-eq-bridge') return;
        if (e.data.type === 'EQ_UPDATE') {
            applyGain(e.data.bandIndex, e.data.gain);
        }
        if (e.data.type === 'EQ_INIT') {
            e.data.gains.forEach((gain, i) => applyGain(i, gain));
        }
    });

    console.log('[BrowserEQ] Engine running in page context');
})();
    `;

    // Inject before anything else loads
    (document.head || document.documentElement).prepend(script);
    script.remove(); // Clean up the tag after execution

    // Bridge: relay messages from extension → page
    browser.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'EQ_UPDATE') return;
        window.postMessage({
            source: 'browser-eq-bridge',
            type: 'EQ_UPDATE',
            bandIndex: message.bandIndex,
            gain: message.gain
        }, '*');
    });

    //Apply saved settings as soon as page loads
    browser.storage.local.get(['eqGains', 'eqBypassed']).then((result) => {
        const gains = result.eqGains || new Array(10).fill(0);
        const bypassed = result.eqBypassed || false;
        window.postMessage({
            source: 'browser-eq-bridge',
            type: 'EQ_INIT',
            gains: gains.map(g => bypassed ? 0 : g)
        }, '*');
    });

})();
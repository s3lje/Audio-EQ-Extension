(function () {
    if (window.__browserEQInjected) return;
    window.__browserEQInjected = true;

    const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    const contexts = new WeakMap();

    function getEQChain(ctx){
        if (contexts.has(ctx)) return contexts.get(ctx);

        const filters = BANDS.map((freq, i) => {
            const filter = ctx.createBiquadFilter();
            if (i === 0) filter.type = "lowshelf";
            else if (i === BANDS.length - 1) filter.type = "highshelf";
            else filter.type = "peaking";

            filter.frequency.value = freq;
            filter.gain.value = 0;
            filter.Q.value = 1;
            return filter;
        });

        for (let i = 0; i < filters.length - 1; i++) {
            filters[i].connect(filters[i+1]);
        }
        filters[filters.length-1].connect(ctx.destionation);

        const chain = { filters, destination: ctx.destionation };
        contexts.set(ctx, chain);
        return chain;
    }

    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    const originalCreate = OriginalAudioContext.prototype.createMediaElementSource;

    OriginalAudioContext.prototype.createMediaElementSource = function (element) {
        const source = originalCreate.call(this, element);
        const chain = getEQChain(this);

        source.connect(chain.filters[0]);
        return source;
    };

    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== "EQ_UPDATE") return;

        const {bandIndex, gain} = event.data;
        contexts.forEach(({filters}) => {
            if (filters[bandIndex]) {
                filters[bandIndex].gain.setTargetAtTime(gain, filters[bandIndex].context.currentTime, 0.01);
            }
        });
    });
})();
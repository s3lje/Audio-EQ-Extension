browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.eqGains) return;

    const gains = changes.eqGains.newValue;
    const bypassed = changes.eqBypassed?.newValue ?? false;

    browser.tabs.query({}).then(tabs => {
        tabs.forEach(tab => {
            if (!tab.url || tab.url.startsWith('about:')) return;
            gains.forEach((gain, i) => {
                browser.tabs.sendMessage(tab.id, {
                    type: 'EQ_UPDATE',
                    bandIndex: i,
                    gain: bypassed ? 0 : gain
                }).catch(() => {});
            });
        });
    });
});
// Apply the last saved visual preference before stylesheets paint the first screen.
(() => {
  try {
    const theme = localStorage.getItem('mn1.appearance.theme.bootstrap.v1');
    if (['ice', 'violet', 'amber', 'lime', 'halloween', 'winter'].includes(theme)) {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // The saved theme is restored from the app's durable store after it opens.
  }
})();

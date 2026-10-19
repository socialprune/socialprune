import { app } from 'electron';

// Imported by the packaged test/probe entry only, never by the release graph.
// Keep real windows and their bounds for visibility/placement assertions,
// without activating them during launch, clicks or a second-instance event.
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false);
  window.show = () => window.showInactive();
  window.focus = () => window.blur();
});

// Preserve the old command as the entrypoint for the replacement local page.
import { startLabelPage } from './label-server.mjs';
startLabelPage().catch(error => { console.error(error.message); process.exitCode = 1; });

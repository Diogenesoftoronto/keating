// Electron's npm package can survive an interrupted or script-skipped install
// without its binary. Its installer is a no-op when the binary is present.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('electron/install.js');

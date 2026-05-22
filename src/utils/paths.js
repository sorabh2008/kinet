export const KINET_DIR = '.kinet';
export const KINET_CONFIG_FILE = 'kinet.config.json';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const templatePath = join(__dirname, '../../templates');

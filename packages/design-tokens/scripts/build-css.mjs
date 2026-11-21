import { writeFileSync } from 'node:fs';
import { buildThemesCss } from '../dist/index.js';
writeFileSync(new URL('../dist/themes.css', import.meta.url), buildThemesCss());
console.log('wrote dist/themes.css');

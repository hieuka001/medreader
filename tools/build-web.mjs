// Đóng gói web-src -> web/ + vendor (pdf.js, jszip) từ node_modules.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const out = join(root, 'web');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'web-src'), out, { recursive: true });

const vendor = join(out, 'vendor');
mkdirSync(vendor, { recursive: true });
const pdfBuild = join(root, 'node_modules/pdfjs-dist/build');
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  cpSync(join(pdfBuild, f), join(vendor, f));
}
// pdf.js standard fonts + cmaps (cần cho nhiều PDF tiếng Việt/Anh)
const pdfRoot = join(root, 'node_modules/pdfjs-dist');
for (const d of ['standard_fonts', 'cmaps']) {
  if (existsSync(join(pdfRoot, d))) cpSync(join(pdfRoot, d), join(vendor, d), { recursive: true });
}
cpSync(join(root, 'node_modules/jszip/dist/jszip.min.js'), join(vendor, 'jszip.min.js'));
console.log('build:web xong ->', out);

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const MOCKUPS_DIR = join(ROOT, 'public', 'mockups');

mkdirSync(MOCKUPS_DIR, { recursive: true });

const htmlPath = join(ROOT, 'mockups-render.html');
const htmlContent = readFileSync(htmlPath, 'utf-8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1600, height: 1200 });

const tempHtmlPath = join(ROOT, 'mockups-temp.html');
writeFileSync(tempHtmlPath, htmlContent);
await page.goto(`file://${tempHtmlPath}`);

await page.waitForTimeout(2000);

// Wait for Tailwind to process all classes
await page.waitForTimeout(1000);

const captures = [
  { filename: 'navbar.png', selector: '.mock-section', nth: 0 },
  { filename: 'phone-mockups.png', selector: '.mock-section', nth: 1 },
  { filename: 'cliente-exito-miscitas.png', selector: '.mock-section', nth: 2 },
  { filename: 'dashboard-mockup.png', selector: '.mock-section', nth: 3 },
  { filename: 'dueno-clientes-nuevacita.png', selector: '.mock-section', nth: 4 },
  { filename: 'dueno-ajustes.png', selector: '.mock-section', nth: 5 },
  { filename: 'employee-mockup.png', selector: '.mock-section', nth: 6 },
  { filename: 'registro-mockup.png', selector: '.mock-section', nth: 7 },
  { filename: 'hero-section.png', selector: '.mock-section', nth: 8 },
];

for (const { filename, selector, nth } of captures) {
  const element = await page.locator(selector).nth(nth);
  if (await element.count() > 0) {
    await element.screenshot({
      path: join(MOCKUPS_DIR, filename),
      type: 'png',
      omitBackground: false,
    });
    console.log(`✅ ${filename} generada`);
  } else {
    console.log(`❌ No se encontró: ${selector} [${nth}]`);
  }
}

// Full overview
await page.screenshot({ path: join(MOCKUPS_DIR, 'overview.png'), type: 'png' });
console.log('✅ overview.png generada');

await browser.close();
unlinkSync(tempHtmlPath);
console.log('\nTodas las imágenes están en public/mockups/');

/**
 * Convert API-FLOWS.html → API-FLOWS.pdf using Puppeteer.
 */
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const htmlPath = path.join(root, "API-FLOWS.html");
const pdfPath = path.join(root, "API-FLOWS.pdf");

const puppeteer = await import("puppeteer");

const browser = await puppeteer.default.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, {
    waitUntil: "networkidle0",
  });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
  });
  console.log(`Wrote ${pdfPath}`);
} finally {
  await browser.close();
}

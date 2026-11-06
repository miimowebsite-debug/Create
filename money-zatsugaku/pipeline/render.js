#!/usr/bin/env node
// HTMLテンプレートを Playwright でスクショする。
// 使い方: node render.js jobs.json
// jobs.json = [{template:"/abs/scene.html", varName:"SCENE", data:{...}, width:1920, height:1080, out:"/abs/x.png"}]
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const TIMEOUT_MS = 20000;

(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const job of jobs) {
      const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
      page.on("pageerror", (e) => console.error(`[render] page error in ${path.basename(job.template)}: ${e.message}`));
      // 1) 読み込み前に window.SCENE / window.THUMB を差し込む
      const payload = JSON.stringify(job.data);
      await page.addInitScript(`window[${JSON.stringify(job.varName)}] = ${payload};`);
      // 2) ?data= でも渡す（どちらの方式のテンプレートでも動くように）
      const url = pathToFileURL(job.template).href + "?data=" + encodeURIComponent(payload);
      await page.goto(url, { waitUntil: "load" });
      try {
        await page.waitForFunction(() => document.body && document.body.dataset.ready === "1", null, { timeout: TIMEOUT_MS });
      } catch (e) {
        console.error(`[render] ERROR: ${path.basename(job.template)} が ${TIMEOUT_MS}ms 以内に data-ready="1" になりませんでした`);
        failed++;
        await page.close();
        continue;
      }
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      await page.screenshot({ path: job.out, clip: { x: 0, y: 0, width: job.width, height: job.height } });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

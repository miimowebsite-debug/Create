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
      const clip = { x: 0, y: 0, width: job.width, height: job.height };
      await page.screenshot({ path: job.out, clip });
      // 見出しを素早く出す演出用: 見出しの文字だけ隠した版も撮る（レイアウトは変えない）
      if (job.hideText && job.outHidden) {
        const found = await page.evaluate((text) => {
          const want = text.replace(/\s+/g, "");
          let best = null;
          for (const el of document.body.querySelectorAll("*")) {
            if (el.textContent.replace(/\s+/g, "") === want) best = el; // 後ろほど内側の要素
          }
          if (!best) return false;
          best.style.visibility = "hidden";
          return true;
        }, job.hideText);
        if (found) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          await page.screenshot({ path: job.outHidden, clip });
        } else {
          fs.writeFileSync(job.outHidden + ".none", "");
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

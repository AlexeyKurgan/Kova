import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";
const temp=process.env.TEMP??"."; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const edge=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",["--headless=new","--remote-debugging-port=9310",`--user-data-dir=${path.join(temp,"opencode","edge-provmodal")}`,"--no-first-run","--hide-scrollbars","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){await sleep(500);try{await fetch("http://127.0.0.1:9310/json/version");break}catch{}}
const browser=await puppeteer.connect({browserURL:"http://127.0.0.1:9310",protocolTimeout:120000,defaultViewport:{width:1440,height:1000}});
const page=await browser.newPage();
await page.goto("http://localhost:1420",{waitUntil:"networkidle0",timeout:120000});
await page.evaluate(()=>localStorage.setItem("kova-theme","dark"));
await page.reload({waitUntil:"networkidle0"}); await sleep(2200);
await page.evaluate(()=>document.querySelector('.nav-item[data-section="Агенты"]')?.click()); await sleep(1800);
console.log("buttons",await page.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent?.trim()).filter(Boolean).slice(0,20)));
const clicked=await page.evaluate(()=>{const b=document.querySelector('.ag-add-toggle');if(b){b.click();return 'toggle'}return null});
console.log("clicked",clicked); await sleep(700);
console.log("menu",await page.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent?.trim()).filter(t=>/провайдер|каталог|API|CLI/i.test(t||''))));
const cat=await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Из каталога/i.test(b.textContent||''));if(b){b.click();return b.textContent}return null});
console.log("catalog",cat); await sleep(1000);
console.log("modal",!!(await page.$(".catalog-modal")));
if(await page.$(".catalog-modal")){
  const count=await page.$$eval(".catalog-card",n=>n.length); console.log("cards",count);
  console.log("glyphs",await page.$$eval(".provider-glyph",n=>n.length));
  await page.screenshot({path:path.join(temp,"opencode","provider-modal.png")});
}
await browser.close();edge.kill();

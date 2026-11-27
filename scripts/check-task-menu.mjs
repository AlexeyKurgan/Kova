import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";
const temp=process.env.TEMP??"."; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<80;i++){try{const r=await fetch("http://127.0.0.1:48621/healthz");if(r.ok)break}catch{}await sleep(500)}
const edge=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",["--headless=new","--remote-debugging-port=9311",`--user-data-dir=${path.join(temp,"opencode","edge-taskmenu")}`,"--no-first-run","--hide-scrollbars","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){await sleep(500);try{await fetch("http://127.0.0.1:9311/json/version");break}catch{}}
const browser=await puppeteer.connect({browserURL:"http://127.0.0.1:9311",protocolTimeout:120000,defaultViewport:{width:1440,height:1000}});
const page=await browser.newPage();
await page.goto("http://127.0.0.1:48621/?folder=%2FC%3A%5Cwork%5CKovaHub",{waitUntil:"networkidle2",timeout:120000});
await sleep(10000);
await page.keyboard.down("Control"); await page.keyboard.down("Shift"); await page.keyboard.press("p"); await page.keyboard.up("Shift"); await page.keyboard.up("Control");
await sleep(800); await page.keyboard.type("Kova Chat: Focus",{delay:25}); await sleep(800); await page.keyboard.press("Enter");
await sleep(4500);
let frame=null; for(const f of page.frames()){try{if(await f.$("#contextButton")){frame=f;break}}catch{}}
console.log("frame",!!frame);
if(frame){
  await frame.click("#historyBtn"); await sleep(600);
  await frame.evaluate(()=>{const row=document.querySelector('#historyList [data-chat]');row?.click()}); await sleep(2000);
  await frame.click("#contextButton"); await sleep(700);
  console.log("options",await frame.$$eval("#contextMenuList .context-option",n=>n.slice(0,4).map(x=>x.innerText)));
  const selected=await frame.evaluate(()=>{const rows=[...document.querySelectorAll('#contextMenuList [data-task-id]')].slice(0,2);rows.forEach(r=>r.click());return rows.length});
  console.log("selected",selected); await sleep(2000);
  console.log("label",await frame.$eval("#contextLabel",n=>n.textContent));
  await page.screenshot({path:path.join(temp,"opencode","task-menu.png")});
}
await browser.close();edge.kill();

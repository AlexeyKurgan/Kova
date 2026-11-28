import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";
const temp=process.env.TEMP??"."; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<80;i++){try{const r=await fetch("http://127.0.0.1:48621/healthz");if(r.ok)break}catch{}await sleep(500)}
const edge=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",["--headless=new","--remote-debugging-port=9309",`--user-data-dir=${path.join(temp,"opencode","edge-edsize")}`,"--no-first-run","--hide-scrollbars","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){await sleep(500);try{await fetch("http://127.0.0.1:9309/json/version");break}catch{}}
const browser=await puppeteer.connect({browserURL:"http://127.0.0.1:9309",protocolTimeout:120000,defaultViewport:{width:1440,height:1000}});
const page=await browser.newPage();
await page.goto("http://127.0.0.1:48621/?folder=%2FC%3A%5Cwork%5CKovaHub",{waitUntil:"networkidle2",timeout:120000});
await sleep(10000);
await page.keyboard.down("Control"); await page.keyboard.down("Shift"); await page.keyboard.press("p"); await page.keyboard.up("Shift"); await page.keyboard.up("Control");
await sleep(800); await page.keyboard.type("Kova Chat: Focus",{delay:25}); await sleep(800); await page.keyboard.press("Enter");
await sleep(4500);
let frame=null; for(const f of page.frames()){try{if(await f.$("#text")){frame=f;break}}catch{}}
if(frame){
  const text=Array.from({length:12},(_,i)=>'Строка '+(i+1)+' длинный текст для авторасширения').join('\n');
  await frame.evaluate((value)=>{const el=document.getElementById('text');const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))},text);
  await sleep(500);
  console.log(await frame.$eval("#text",n=>({height:n.getBoundingClientRect().height, scroll:n.scrollHeight, overflow:getComputedStyle(n).overflowY})));
  await page.screenshot({path:path.join(temp,"opencode","editor-size.png")});
}
await browser.close();edge.kill();

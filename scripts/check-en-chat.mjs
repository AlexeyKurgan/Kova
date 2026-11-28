import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";
const temp=process.env.TEMP??"."; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const edge=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",["--headless=new","--remote-debugging-port=9327",`--user-data-dir=${path.join(temp,"opencode","edge-en-chat")}`,"--no-first-run","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){await sleep(500);try{await fetch("http://127.0.0.1:9327/json/version");break}catch{}}
const browser=await puppeteer.connect({browserURL:"http://127.0.0.1:9327",protocolTimeout:120000,defaultViewport:{width:1440,height:1000}});
const page=await browser.newPage();
await page.goto("http://localhost:1420",{waitUntil:"networkidle0",timeout:120000});
await page.evaluate(()=>{localStorage.setItem("kova-theme","dark");localStorage.setItem("kova-app-preferences",JSON.stringify({language:"en"}))});
await page.reload({waitUntil:"networkidle0"}); await sleep(2800);
await page.evaluate(()=>{const c=document.querySelector(".onboarding-modal .icon-btn");if(c instanceof HTMLElement)c.click()}); await sleep(500);
await page.evaluate(()=>{document.querySelector('.nav-item[data-section="Чат"]')?.click()}); await sleep(2200);
console.log(JSON.stringify(await page.evaluate(()=>({head:document.querySelector(".chat-side-head")?.innerText ?? "", empty:document.querySelector(".chat-empty")?.innerText ?? "", body:document.body.innerText.slice(0,900)})),null,2));
await page.screenshot({path:path.join(temp,"opencode","en-chat.png")});
await browser.close();edge.kill();

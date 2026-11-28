import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";
const temp=process.env.TEMP??"."; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const edge=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",["--headless=new","--remote-debugging-port=9312",`--user-data-dir=${path.join(temp,"opencode","edge-hubic")}`,"--no-first-run","--hide-scrollbars","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){await sleep(500);try{await fetch("http://127.0.0.1:9312/json/version");break}catch{}}
const browser=await puppeteer.connect({browserURL:"http://127.0.0.1:9312",protocolTimeout:120000,defaultViewport:{width:1440,height:1000}});
const page=await browser.newPage();
await page.goto("http://localhost:1420",{waitUntil:"networkidle0",timeout:120000});
await page.evaluate(()=>localStorage.setItem("kova-theme","dark"));
await page.reload({waitUntil:"networkidle0"}); await sleep(2200);
// provider catalog
await page.evaluate(()=>document.querySelector('.nav-item[data-section="Агенты"]')?.click()); await sleep(1500);
await page.click(".ag-add-toggle"); await sleep(500);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Из каталога/.test(b.textContent||''));b?.click()}); await sleep(1200);
console.log("icons",await page.$$eval(".catalog-icon img.provider-icon",n=>n.length),"fallback",await page.$$eval(".catalog-icon .provider-fallback-icon",n=>n.length));
await page.screenshot({path:path.join(temp,"opencode","hub-provider-icons.png")});
// close modal, chat
await page.evaluate(()=>{const b=document.querySelector('.catalog-modal .icon-btn');b?.click()}); await sleep(500);
await page.evaluate(()=>document.querySelector('.nav-item[data-section="Чат"]')?.click()); await sleep(1200);
await page.evaluate(()=>{const row=[...document.querySelectorAll('.chat-list-item')].find(n=>n.textContent?.includes('Новый чат'));row?.click()}); await sleep(2000);
await page.click(".chat-context-trigger"); await sleep(700);
console.log("taskmenu",await page.$$eval(".chat-task-option",n=>n.slice(0,4).map(x=>x.innerText)));
await page.screenshot({path:path.join(temp,"opencode","hub-task-menu.png")});
await browser.close();edge.kill();

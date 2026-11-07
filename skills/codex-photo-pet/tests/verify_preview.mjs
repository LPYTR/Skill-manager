// Exercise the generated native-timing viewer in its own hidden browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [pageFile,outputDirectory,browserFile]=process.argv.slice(2);
if(!pageFile||!outputDirectory)throw Error('Usage: node verify_preview.mjs PREVIEW.html OUTPUT_DIR [BROWSER_EXE]');
const output=path.resolve(outputDirectory);
await fs.mkdir(output,{recursive:true});
const candidates=[browserFile,process.env.PET_BROWSER,
  path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean);
let executable;
for(const candidate of candidates){try{await fs.access(candidate);executable=candidate;break}catch{}}
if(!executable)throw Error('No installed Chromium browser; pass its executable path');
const profileDirectory=path.join(output,`profile-${Date.now()}`);
const browser=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profileDirectory}`,
  '--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=800,900','about:blank'],
  {windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,spawnError;
browser.on('error',error=>{spawnError=error});
try{
  let port;
  for(let index=0;index<80;index++){
    if(spawnError)throw spawnError;
    try{port=Number((await fs.readFile(path.join(profileDirectory,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}
    await delay(100);
  }
  if(!port)throw Error('Isolated browser did not start');
  const response=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(path.resolve(pageFile)).href)}`,{method:'PUT'});
  const target=await response.json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let id=0;const pending=new Map();
  socket.onmessage=event=>{
    const value=JSON.parse(event.data),task=pending.get(value.id);
    if(task){pending.delete(value.id);clearTimeout(task.timer);value.error?task.reject(Error(JSON.stringify(value.error))):task.resolve(value.result)}
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const next=++id;
    const timer=setTimeout(()=>{pending.delete(next);reject(Error(`Timeout: ${method}`))},10000);
    pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params}));
  });
  const evaluate=async expression=>{
    const response=await send('Runtime.evaluate',{expression,returnByValue:true});
    if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const captureCanvas=async()=>{
    const clip=await evaluate('(()=>{const box=canvas.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height,scale:1}})()');
    return (await send('Page.captureScreenshot',{format:'png',clip})).data;
  };
  let loaded=false;
  for(let index=0;index<60;index++){
    loaded=await evaluate("typeof ready !== 'undefined' && ready");
    if(loaded)break;
    await delay(100);
  }
  assert.equal(loaded,true,'Encoded atlas must load');
  const initial=await evaluate('({timing:profile.timing_profile,idleMs:profile.states[0].durations.reduce((a,b)=>a+b,0),actionCycles:profile.action_cycles,reduced:reduced.matches,paused,speed})');
  assert.equal(initial.timing,'native');assert.equal(initial.idleMs,6600);assert.equal(initial.actionCycles,3);
  if(initial.paused)await evaluate("document.getElementById('pause').click()"); // Explicit playback in this test page only.
  await evaluate("document.querySelectorAll('nav button')[0].click()");
  const first=await captureCanvas();
  await delay(950);
  assert.equal(await evaluate('frame'),0,'Idle first pose must hold 1680ms, not the base 280ms');
  await delay(850);
  assert.equal(await evaluate('frame'),1,'Native idle must advance after its longer hold');
  assert.notEqual(await captureCanvas(),first,'The canvas must show a different pose');
  await evaluate("document.querySelectorAll('nav button')[3].click()");
  await delay(2250);
  assert.equal(await evaluate('state'),0,'Three greeting cycles must settle back into idle');
  const control=await evaluate("(()=>{const input=document.getElementById('speed');input.value='0.65';input.dispatchEvent(new Event('change'));document.querySelectorAll('nav button')[1].click();return speed})()");
  assert.equal(control,.65);
  await delay(250);
  assert.equal(await evaluate('frame'),1,'Speed selector must affect only one timing division');
  const paused=await evaluate("(()=>{document.getElementById('pause').click();return {state,frame}})()");
  await delay(300);
  assert.deepEqual(await evaluate('({state,frame})'),paused,'Pause must stop visible frame advancement');
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(output,'viewer.png'),Buffer.from(screenshot.data,'base64'));
  const result={ok:true,page:path.resolve(pageFile),page_sha256:createHash('sha256').update(await fs.readFile(pageFile)).digest('hex'),
    native_idle_ms:initial.idleMs,idle_pose_hold_verified:true,canvas_motion_verified:true,
    three_action_cycles_then_idle:true,speed_selector_verified:true,pause_verified:true,
    live_codex_window_observed:false};
  await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  await send('Browser.close').catch(()=>{});
}finally{socket?.close();browser.kill()}

import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),options={};
if(args.includes('--help')){console.log('node verify_browser.mjs --sheet FILE --output DIR [--browser EXE] [--rows 9|11] [--durations 140,140,140,280] [--samples 32]');process.exit(0)}
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw Error('Use --key value arguments');options[args[i].slice(2)]=args[i+1]}
if(!options.sheet||!options.output){console.log('node verify_browser.mjs --sheet FILE --output DIR [--browser EXE] [--rows 9|11] [--durations 140,140,140,280] [--samples 32]');process.exit(1)}
const rows=Number(options.rows||9),durations=(options.durations||'140,140,140,280').split(',').map(Number),count=Number(options.samples||32);
if(![9,11].includes(rows)||durations.length!==4||durations.some(x=>!Number.isFinite(x)||x<=0)||!Number.isInteger(count)||count<20||count>200)throw Error('Invalid geometry/timing/sample count');
const directory=path.dirname(fileURLToPath(import.meta.url)),output=path.resolve(options.output);
await fs.mkdir(output,{recursive:true});
const candidates=[options.browser,process.env.PET_BROWSER,
  path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
let executable;
for(const candidate of candidates){try{await fs.access(candidate);executable=candidate;break}catch{}}
if(!executable)throw Error('No Chromium browser found; pass --browser. No browser will be downloaded automatically.');
const profile=path.join(output,`profile-${Date.now()}`),delay=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','--disable-extensions','--hide-scrollbars',
  '--window-size=420,300','--force-device-scale-factor=1','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,spawnError;child.on('error',e=>{spawnError=e});
try{
  let port;
  for(let i=0;i<80;i++){if(spawnError)throw spawnError;try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}await delay(150)}
  if(!port)throw Error('Browser did not open its private debugging endpoint');
  const page=pathToFileURL(path.join(directory,'../assets/native-probe.html')).href;
  const response=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(page)}`,{method:'PUT'});
  if(!response.ok)throw Error('Cannot create local probe page');
  const target=await response.json();socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let id=0;const pending=new Map();
  socket.onmessage=e=>{const message=JSON.parse(e.data),task=pending.get(message.id);if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(Error(`Timed out: ${method}`))},20000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params}))});
  await send('Page.enable');
  let ready=false;
  for(let i=0;i<40;i++){const result=await send('Runtime.evaluate',{expression:'typeof window.startProbe',returnByValue:true});if(result.result.value==='function'){ready=true;break}await delay(100)}
  if(!ready)throw Error('Probe template did not load');
  const reduced=(await send('Runtime.evaluate',{expression:"matchMedia('(prefers-reduced-motion: reduce)').matches",returnByValue:true})).result.value;
  if(reduced!==false)throw Error('Reduced-motion preference blocks the intrinsic animation technique');
  const bytes=await fs.readFile(path.resolve(options.sheet)),configuration={rows,durations,src:`data:image/webp;base64,${bytes.toString('base64')}`};
  const started=await send('Runtime.evaluate',{expression:`window.startProbe(${JSON.stringify(configuration)})`,awaitPromise:true,returnByValue:true});
  if(started.exceptionDetails)throw Error(JSON.stringify(started.exceptionDetails));
  const samples=[];
  for(let index=0;index<count;index++){
    const state=await send('Runtime.evaluate',{expression:'({time:performance.now(),column:window.nativeColumn})',returnByValue:true});
    const capture=await send('Page.captureScreenshot',{format:'png',clip:{x:20,y:20,width:192,height:208,scale:1}});
    const filename=`sample-${String(index).padStart(3,'0')}.png`;
    const pixels=Buffer.from(capture.data,'base64');
    await fs.writeFile(path.join(output,filename),pixels);
    samples.push({...state.result.value,file:filename,sha256:createHash('sha256').update(pixels).digest('hex')});await delay(80);
  }
  const report={image_sha256:createHash('sha256').update(bytes).digest('hex'),browser:executable,rows,durations,reduced_motion:reduced,started:started.result.value,samples};
  await fs.writeFile(path.join(output,'samples.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({samples:samples.length,output,reduced_motion:reduced}));
  await send('Browser.close').catch(()=>{});
}finally{socket?.close();child.kill()}

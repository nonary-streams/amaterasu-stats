import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import ts from "typescript";
import {createServer} from "node:http";
const sdkRoot=resolve(process.env.AMATERASU_SDK_ROOT ?? "../../..");
const plugin=readFileSync("dist/stats.js","utf8"), css=readFileSync("dist/stats.css","utf8");
const server=createServer((request,response)=>{
  if(request.url.endsWith("stats.js")){response.setHeader("Content-Type","text/javascript");response.end(plugin);}
  else if(request.url.endsWith("stats.css")){response.setHeader("Content-Type","text/css");response.end(css);}
  else if(request.url==="/base.css"){response.setHeader("Content-Type","text/css");response.end(readFileSync(join(sdkRoot,"frontend/dist/styles.css")));}
  else response.end('<!doctype html><meta charset=utf-8><link rel="stylesheet" href="/base.css"><main style="padding:24px;max-width:1400px;margin:auto"><div id="sections"></div></main>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "amaterasu-stats-"));
const browser = spawn(process.env.AMATERASU_BROWSER ?? "chromium", ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let socket;
try {
  let address;
  for (let i = 0; i < 200; i++) {
    try {
      const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split("\n");
      address = `ws://127.0.0.1:${port}${path}`;
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(address, "Chromium debugger did not start");
  socket = new WebSocket(address);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
  };
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command("Target.createTarget", { url: origin });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  await command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
    return result.result.value;
  };
  for (let i = 0; i < 100 && !await evaluate(`!!document.querySelector('#sections')`); i++) await new Promise(resolve => setTimeout(resolve, 20));
  const source = ['locale-catalogs.ts','locale.ts','ui.ts','extension_ui.ts','extension_ui_layout.ts','extension_ui_tabs.ts','extension_ui_feedback.ts','extension_ui_dialog.ts','extension_ui_charts.ts','extension_slots.ts','extensions.ts'].map(file=>readFileSync(join(sdkRoot,'frontend/src',file),'utf8')).join('\n');
  await evaluate(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}));
  const configuration=JSON.parse(readFileSync('ui.json','utf8'));
  await evaluate(`(async()=>{
    window.calls=[];window.counter=0;window.writes=[];window.preferencesRevision=1;window.readOnly=false;
    window.preferences={enabled:true,poll_interval_ms:250,history_retention_seconds:300,max_history_points:300,pause_when_hidden:true,show_active_sessions:true,show_host_stats:true,show_host_charts:true,show_session_history:true};
    window.saved={session_id:'recorded-1',protocol:'rtsp',client_name:'Living room',device_name:'Client',app_name:'Example game',width:2560,height:1440,target_fps:120,target_bitrate_kbps:50000,codec:'hevc',started_at_unix:1700000000,ended_at_unix:1700000060,duration_seconds:60};
    const snapshot={cpu_percent:28,cpu_temp_c:52,ram_used_bytes:17179869184,ram_total_bytes:34359738368,gpu_percent:63,gpu_encoder_percent:12,gpu_temp_c:64,vram_used_bytes:8589934592,vram_total_bytes:25769803776,net_rx_bps:500000,net_tx_bps:50000000};
    window.api={allows:()=>true,post:async(route,payload)=>{
      calls.push([route,payload]);
      if(route==='extensions/list')return {extensions:[{id:'stats',name:'Statistics',sdk_version:1,digest:'a'.repeat(64),entrypoint:'stats.js',placements:['page','overview','settings'],methods:${JSON.stringify(configuration.methods)}.filter(method=>!readOnly||!method.scope.endsWith(".write"))}]};
      if(route!=='extensions/call')throw Error(route);
      const alias=payload.method;
      if(alias==='preferences')return {ok:true,revision:preferencesRevision,settings:preferences};
      if(alias==='preferences_update'){writes.push(payload.payload);if(window.deferSave)await new Promise(resolve=>window.releaseSave=resolve);Object.assign(preferences,payload.payload.settings);return {ok:true,revision:++preferencesRevision,settings:preferences};}
      if(alias==='history_preferences')return {ok:true,revision:1,settings:{enabled:true,ttl_days:30,db_size_limit_mb:100},effective_enabled:true};
      if(alias==='history_status')return {ok:true,status:{available:true,configuration_ready:true,applied_revision:1,enabled:true,effective_enabled:true,degraded:false,failed_operations:0,active_streams:1,pending_activities:0,sessions:1,samples:4,events:0,live_bytes:5000,last_prune:{sessions_deleted:0,live_bytes:5000,size_limit_bytes:0,size_limit_unmet:false}}};
      if(alias==='host')return {ok:true,available:true,platform:'linux',sampled_at_unix_ms:Date.now(),host:snapshot,samples:Array.from({length:20},(_,i)=>({recorded_at_unix_ms:Date.now()-20000+i*1000,host:{...snapshot,cpu_percent:25+Math.sin(i)*8,gpu_percent:50+Math.sin(i/2)*30}}))};
      if(alias==='streams'){counter++;return {ok:true,epoch:'b'.repeat(32),sampled_at_ms:String(counter*250),sampled_at_unix_ms:String(Date.now()),sessions:[{session_id:'live-1',started_at_unix:1700000000,device_name:'Living room',width:2560,height:1440,target_fps:120,target_bitrate_kbps:50000,codec:'hevc',frames_sent:String(counter*30),bytes_sent:String(counter*1500000),sequence_gaps:'0'}]};}
      if(alias==='history_list')return {ok:true,sessions:[saved],next_offset:null};
      if(alias==='history_detail'){
        const id=payload.payload.session_id;
        if(id!=='recorded-1')return {ok:false,code:'not_found',message:'No recorded history for this live stream'};
        return {ok:true,detail:{session:saved,sample_count:20,event_count:0,samples_truncated:false,events_truncated:false,samples:Array.from({length:20},(_,i)=>({session_id:id,recorded_at_unix:1700000000+i,frames_sent:i*120,bytes_sent:i*5000000,dropped_frames:0,actual_fps:119+Math.sin(i)*.8,actual_bitrate_kbps:40000+i*100,encode_latency_ms:i%7===0?null:2+i/20})),events:[]}};
      }
      throw Error(alias);
    }};
    const original=api.post;api.post=async(...args)=>{const result=await original(...args);return args[0]==='extensions/call'?{result}:result;};
    window.pages=new Amaterasu.ExtensionPages(api);await pages.discover();await pages.mount('stats',document.querySelector('#sections'));
  })()`);
  for(let i=0;i<200&&!await evaluate(`document.querySelectorAll('.plugin-metric-gauge').length===4&&document.querySelectorAll('.live-session-card').length===1`);i++)await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(await evaluate(`document.querySelectorAll('.plugin-metric-gauge').length`),4,'plugin owns four measured gauges');
  assert.equal(await evaluate(`document.querySelectorAll('.live-session-card').length`),1,'live card loads through approved SDK aliases');
  assert.equal(await evaluate(`document.querySelectorAll('.plugin-metric-chart').length>=6`),true);
  await evaluate(`window.firstPlot=document.querySelector('.plugin-metric-plot');document.querySelector('.plugin-chart-controls button').click();`);
  assert.match(await evaluate(`firstPlot.getAttribute('aria-label')`),/2× zoom/);
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.equal(await evaluate(`firstPlot===document.querySelector('.plugin-metric-plot')`),true,'polls preserve chart focus and zoom');
  assert.match(await evaluate(`firstPlot.getAttribute('aria-label')`),/2× zoom/);
  await evaluate(`firstPlot.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));`);
  assert.match(await evaluate(`document.querySelector('.plugin-chart-readout').textContent`),/CPU|GPU|Memory/);
  await evaluate(`[...document.querySelectorAll('.history-card button')].find(node=>node.textContent==='Details').click()`);
  for(let i=0;i<100&&!await evaluate(`!!document.querySelector('.recorded-session-detail')`);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await evaluate(`!!document.querySelector('.recorded-session-detail .plugin-metric-chart')`),true,'recorded detail uses shared interactive charts');
  const directory=process.env.AMATERASU_QUALIFICATION_DIR;
  if(directory){mkdirSync(directory,{recursive:true});const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId);writeFileSync(join(directory,'stats-desktop.png'),Buffer.from(shot.data,'base64'));}
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  await evaluate(`document.querySelector('.recorded-session-detail')?.scrollIntoView()`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`),true,'mobile page does not overflow');
  if(directory){const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId);writeFileSync(join(directory,'stats-mobile.png'),Buffer.from(shot.data,'base64'));}
  await evaluate(`document.querySelector('.stats-preferences').open=true;const field=document.querySelector('[name=realtime_stats_poll_interval_ms]');field.value='500';field.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await evaluate(`pages.isDirty()`),true,'settings drafts are visible to the generic shell guard');
  await evaluate(`window.deferSave=true;document.querySelector('[name=realtime_stats_poll_interval_ms]').form.requestSubmit()`);
  for(let i=0;i<100&&!await evaluate(`!!window.releaseSave`);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await evaluate(`pages.isBusy()`),true,'pending writes block navigation');
  await evaluate(`releaseSave()`);
  for(let i=0;i<100&&await evaluate(`pages.isBusy()||pages.isDirty()`);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await evaluate(`!pages.isBusy()&&!pages.isDirty()&&writes[0].expected_revision===1`),true,'confirmed readback clears only saved drafts');
  await evaluate(`pages.dispose();window.before=calls.length;`);
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(await evaluate(`calls.length===before&&!document.querySelector('.stats-plugin')`),true,'closing retires polling and visual controls');
  await evaluate(`readOnly=true;pages=new Amaterasu.ExtensionPages(api);await pages.discover();await pages.mountSlot('stats',document.querySelector('#sections'),'settings');` .replace('readOnly=true;', '(async()=>{readOnly=true;')+'})()');
  for(let i=0;i<100&&!await evaluate(`document.querySelectorAll('.stats-plugin form').length===2`);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await evaluate(`document.querySelectorAll(".stats-plugin form").length`),2);
  assert.equal(await evaluate(`[...document.querySelectorAll('.stats-plugin form button[type=submit]')].every(node=>node.disabled)`),true,'signed alias filtering makes settings read-only');
  await evaluate(`(async()=>{pages.dispose();pages=new Amaterasu.ExtensionPages(api);await pages.discover();await pages.mountSlot('stats',document.querySelector('#sections'),'overview');})()`);
  for(let i=0;i<100&&!await evaluate(`document.querySelectorAll('.plugin-metric-gauge').length===4`);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await evaluate(`document.querySelectorAll('.plugin-metric-gauge').length===4&&!document.querySelector('.live-session-card')`),true,'overview surface is plugin-owned and independent');
  await evaluate(`pages.dispose()`);
  console.log('PASS: independently loaded stats plugin, live gauges, stable zoom, keyboard inspection, recorded detail, mobile layout, and cleanup');
} finally {
  socket?.close();browser.kill('SIGTERM');
  await new Promise(resolve=>browser.once('exit',resolve));
  rmSync(profile,{recursive:true,force:true});
  await new Promise(resolve=>server.close(resolve));
}

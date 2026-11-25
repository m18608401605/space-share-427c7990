import {decodeKey,importKey,unseal,seal,unpack,PACKAGE_AAD,STORAGE_AAD} from './crypto.js';
const $=selector=>document.querySelector(selector),decode=new TextDecoder(),encode=new TextEncoder();
const gate=$('#gate'),message=$('#message'),heading=$('#heading'),progress=$('#progress'),bar=$('#session-bar'),saveState=$('#save-state');
let key=null,frame=null,storageId='',saveQueue=Promise.resolve(),pendingSaves=0,saveFailed=false,shareURL=location.href;
const blobURLs=[];
const b64=bytes=>{let result='';for(let n=0;n<bytes.length;n+=16384)result+=String.fromCharCode(...bytes.subarray(n,n+16384));return btoa(result);};
const fromB64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function storageShape(value){return value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length<=50&&Object.entries(value).every(([k,v])=>/^beichen-[\w-]{1,100}$/.test(k)&&typeof v==='string')&&JSON.stringify(value).length<=3000000;}
function error(text){heading.textContent='暂时无法打开';message.textContent=text;progress.hidden=true;$('#access-entry').hidden=false;$('#unlock-button').disabled=false;}
async function restore(){
  try{const stored=localStorage.getItem(storageId);if(!stored)return {};
    const restored=JSON.parse(decode.decode(await unseal(fromB64(stored),key,STORAGE_AAD)));
    return storageShape(restored)?restored:{};
  }catch{saveState.textContent='旧缓存无法读取，可重新导入方案';return {};}
}
function persist(values){
  const snapshot=encode.encode(JSON.stringify(values)),activeKey=key,id=storageId;
  pendingSaves++;
  saveState.textContent='正在加密保存…';
  saveQueue=saveQueue.then(async()=>{
    const encrypted=await seal(snapshot,activeKey,STORAGE_AAD);
    localStorage.setItem(id,b64(encrypted));saveFailed=false;
  }).catch(()=>{saveFailed=true;}).finally(()=>{
    pendingSaves--;
    saveState.textContent=pendingSaves>0?'正在加密保存…':saveFailed?'本地保存失败，请导出方案留存':'已加密保存到此浏览器';
  });
}
window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
  if(event.data?.type==='private-space-save'&&key&&storageShape(event.data.values))persist(event.data.values);
});
window.addEventListener('beforeunload',event=>{if(pendingSaves>0||saveFailed){event.preventDefault();event.returnValue='';}});
function bridgeScript(initial,assets){
  const data=JSON.stringify({initial,assets,origin:location.origin,search:'?room=living&view=interior&scheme=dimensions'}).replace(/</g,'\\u003c');
  return `(()=>{const data=${data};window.__BEICHEN_ASSETS__=Object.freeze(data.assets);window.__BEICHEN_ENTRY_SEARCH__=data.search;const entries=new Map(Object.entries(data.initial));const notify=()=>parent.postMessage({type:'private-space-save',values:Object.fromEntries(entries)},data.origin);const store={getItem(k){return entries.get(String(k))??null;},setItem(k,v){k=String(k);v=String(v);if(!/^beichen-[\\w-]{1,100}$/.test(k))throw new DOMException('Unsupported key','SecurityError');const next=new Map(entries);next.set(k,v);if(JSON.stringify(Object.fromEntries(next)).length>3000000)throw new DOMException('Storage full','QuotaExceededError');entries.set(k,v);notify();},removeItem(k){entries.delete(String(k));notify();},clear(){entries.clear();notify();},key(i){return [...entries.keys()][i]??null;},get length(){return entries.size;}};Object.defineProperty(window,'localStorage',{value:store,configurable:false});})();`;
}
async function open(){
  const token=new URLSearchParams(location.hash.slice(1)).get('k');
  if(!token){heading.textContent='输入访问码打开空间';message.textContent='如果聊天软件截断了链接，请在下方粘贴分享者发来的访问码，也可以粘贴完整链接。';return;}
  if(!crypto.subtle||!globalThis.DecompressionStream){error('请用新版 Safari、Chrome 或 Edge 打开完整链接。');return;}
  try{
    const raw=decodeKey(token);key=await importKey(raw);
    const fingerprint=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));raw.fill(0);
    storageId='private-space-encrypted-'+Array.from(fingerprint.slice(0,16),n=>n.toString(16).padStart(2,'0')).join('');
    $('#access-entry').hidden=true;progress.hidden=false;heading.textContent='正在打开空间';message.textContent='首次打开需要下载约 30 MB 模型和材质，请稍候。';
    const infoResponse=await fetch('./payload.json',{cache:'no-store',referrerPolicy:'no-referrer'});if(!infoResponse.ok)throw new Error('download');
    const info=await infoResponse.json();
    if(!/^pack-[a-f0-9]{16}\.bin$/.test(info.file)||!Number.isSafeInteger(info.bytes)||info.bytes>100*1024*1024)throw new Error('download');
    const response=await fetch('./'+info.file,{cache:'force-cache',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('download');
    const reader=response.body.getReader(),chunks=[];let received=0;
    progress.max=info.bytes;progress.value=0;
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;if(received>info.bytes)throw new Error('download');chunks.push(value);progress.value=received;}
    if(received!==info.bytes)throw new Error('download');
    const encrypted=new Uint8Array(received);let offset=0;for(const chunk of chunks){encrypted.set(chunk,offset);offset+=chunk.length;}
    message.textContent='正在解锁模型与材质…';
    const compressed=await unseal(encrypted,key,PACKAGE_AAD);
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const files=unpack(await new Response(stream).arrayBuffer()),assets={};
    for(const [path,file]of files){const url=URL.createObjectURL(new Blob([file.bytes],{type:file.mime}));assets[path]=url;blobURLs.push(url);}
    const initial=await restore();
    const html=new DOMParser().parseFromString(decode.decode(files.get('index.html').bytes),'text/html');
    const bridge=html.createElement('script');bridge.textContent=bridgeScript(initial,assets);html.head.prepend(bridge);
    for(const link of html.querySelectorAll('link[rel="stylesheet"]')){const path=link.getAttribute('href').replace(/^\.\//,'').split('?')[0];if(!assets[path])throw new Error('asset');link.href=assets[path];}
    for(const script of html.querySelectorAll('script[src]')){const path=script.getAttribute('src').replace(/^\.\//,'').split('?')[0];if(!assets[path])throw new Error('asset');script.src=assets[path];}
    frame=document.createElement('iframe');frame.title='可编辑三维空间';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-forms');frame.referrerPolicy='no-referrer';frame.srcdoc='<!doctype html>'+html.documentElement.outerHTML;
    document.body.append(frame);gate.hidden=true;bar.hidden=false;document.title='空间布置 · 私密分享';
  }catch(e){key=null;error(e.message==='download'?'下载未完成，请检查网络后刷新。':'链接不完整、访问钥匙不匹配，或文件已损坏。请重新获取完整链接。');}
}
$('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(shareURL);$('#copy-link').textContent='已复制，请谨慎转发';}catch{$('#copy-link').textContent='请复制地址栏完整链接';}};
function accessToken(value){
  const input=String(value).trim();
  const token=input.includes('#')?new URLSearchParams(input.slice(input.indexOf('#')+1)).get('k'):input;
  decodeKey(token);
  return token;
}
$('#unlock-button').onclick=async()=>{
  if($('#unlock-button').disabled)return;
  try{
    const token=accessToken($('#access-code').value);
    history.replaceState(null,'',location.pathname+location.search+'#k='+token);
    shareURL=location.href;$('#access-code').value='';$('#unlock-button').disabled=true;
    await open();
  }catch{error('访问码不完整，请完整复制访问码或分享链接后重试。');}
};
$('#access-code').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('#unlock-button').onclick();}};
$('#lock').onclick=async()=>{await saveQueue;frame?.remove();frame=null;for(const url of blobURLs)URL.revokeObjectURL(url);blobURLs.length=0;key=null;shareURL='';history.replaceState(null,'',location.pathname);bar.hidden=true;gate.hidden=false;progress.hidden=true;$('#access-entry').hidden=false;$('#unlock-button').disabled=false;heading.textContent='空间已锁定';message.textContent='再次查看请重新输入访问码或打开完整分享链接。';document.title='私密空间分享';};
open();

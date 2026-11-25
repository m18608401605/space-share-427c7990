export const PACKAGE_AAD = new TextEncoder().encode('private-space-package/v1');
export const STORAGE_AAD = new TextEncoder().encode('private-space-storage/v1');
export function decodeKey(text) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text || '')) throw new Error('invalid-key');
  const raw=Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
  if(raw.length!==32)throw new Error('invalid-key');
  return raw;
}
export async function importKey(raw) {
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
export async function seal(bytes,key,aad) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,bytes));
  const out=new Uint8Array(16+encrypted.length);
  out.set([83,80,75,49]);out.set(iv,4);out.set(encrypted,16);return out;
}
export async function unseal(bytes,key,aad) {
  if(bytes.length<33||bytes[0]!==83||bytes[1]!==80||bytes[2]!==75||bytes[3]!==49)throw new Error('invalid-package');
  return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(4,16),additionalData:aad,tagLength:128},key,bytes.slice(16));
}
export function unpack(buffer) {
  if(buffer.byteLength<4||buffer.byteLength>160*1024*1024)throw new Error('invalid-size');
  const size=new DataView(buffer).getUint32(0,true);
  if(size<1||size>1024*1024||size+4>buffer.byteLength)throw new Error('invalid-index');
  const header=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size)));
  if(header.version!==1||!Array.isArray(header.files)||header.files.length>300)throw new Error('invalid-index');
  const files=new Map(),start=4+size;
  for(const file of header.files){
    if(typeof file.path!=='string'||!/^[-\w./]+$/.test(file.path)||file.path.startsWith('/')||file.path.split('/').includes('..')||files.has(file.path))throw new Error('invalid-path');
    if(!Number.isSafeInteger(file.offset)||!Number.isSafeInteger(file.size)||file.offset<0||file.size<0||start+file.offset+file.size>buffer.byteLength)throw new Error('invalid-range');
    if(!['text/html','text/css','text/javascript','text/plain','image/jpeg','image/png','image/webp','image/svg+xml','model/gltf-binary','application/octet-stream'].includes(file.mime))throw new Error('invalid-type');
    files.set(file.path,{...file,bytes:new Uint8Array(buffer,start+file.offset,file.size)});
  }
  for(const name of ['index.html','app.js','styles.css'])if(!files.has(name))throw new Error('missing-entry');
  return files;
}

// Minimal Google Apps Script mock: runs ../apps-script/Code.gs against an in-memory sheet and script properties.
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
module.exports=function(rows){
  const props={KEYS:'GOOD'};
  const HEADER_LEN=21;
  const data=[[]];             // row 0 = header (filled by sheet_())
  (rows||[]).forEach(r=>{ const x=r.slice(); while(x.length<HEADER_LEN) x.push(''); data.push(x); });
  const range=(r,c,nr,nc)=>({
    getValues:()=>{ const out=[]; for(let i=0;i<nr;i++){ const row=data[r-1+i]||[]; const o=[]; for(let j=0;j<nc;j++) o.push(row[c-1+j]===undefined?'':row[c-1+j]); out.push(o);} return out; },
    setValues:v=>{ v.forEach((row,i)=>{ const idx=r-1+i; while(data.length<=idx) data.push([]); const t=data[idx]; row.forEach((val,j)=>{ t[c-1+j]=val instanceof Date? val.toISOString(): val; }); }); }
  });
  const sheet={getRange:range,getLastRow:()=>data.length,getDataRange:()=>range(1,1,data.length,HEADER_LEN),setFrozenRows(){},setName(){}};
  const ctx={
    SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheet,insertSheet:()=>sheet})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v)},deleteProperty:k=>{delete props[k]}})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    ContentService:{createTextOutput:t=>({t,setMimeType(){return this}}),MimeType:{JSON:'json'}},
    Utilities:{getUuid:()=>crypto.randomUUID()},
    console, Date, JSON, Math, Number, String, Object, Array, Boolean, RegExp, isFinite, parseInt, parseFloat
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','apps-script','Code.gs'),'utf8')+';this.doPost=doPost;',ctx);
  return {api:{doPost:e=>ctx.doPost(e)},data,props};
};

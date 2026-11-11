'use strict';
// Presentation derives opening balances from permanent history. No reset/copy entries.
function awtarMonthNow(){return today().slice(0,7);}
function validMonth(m){return typeof m==='string'&&/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(m);}
function monthEnd(m){return new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).toISOString().slice(0,10);}
function monthDate(m){return m===awtarMonthNow()?today():monthEnd(m);}
filterMonth=awtarMonthNow();
let monthFollowCurrent=true,monthGeneration=0,monthlyStatus=null,monthlyError=null;
if(!tabs.some(t=>t[0]==='monthly'))tabs.push(['monthly','الإقفال الشهري']);
function monthRows(state,m){return state.entries.filter(e=>e.date?.slice(0,7)===m&&!awtarAutomaticReturn(e));}
function monthAmounts(state,m){
 const before=state.entries.filter(e=>e.date?.slice(0,7)<m&&!awtarAutomaticReturn(e));
 const rows=monthRows(state,m),net=(a,method)=>a.reduce((n,e)=>n+(e.method===method?(e.type==='income'?1:e.type==='expense'?-1:0)*Number(e.amount):0),0);
 return {rows,openingCash:net(before,'نقدي'),openingMaster:net(before,'ماستر كارد'),cash:net(rows,'نقدي'),master:net(rows,'ماستر كارد')};
}
function monthLocked(m){return !!monthlyStatus&&m<monthlyStatus.current_month&&!monthlyStatus.reopened.some(x=>x.month===m);}
function monthToolbar(){return `<section class="panel topline no-print"><div><label for="awtarMonth">الشهر المعروض</label><input id="awtarMonth" type="month" value="${esc(filterMonth)}" max="${awtarMonthNow()}" onchange="selectMonth(this.value)"></div><button onclick="go('monthly')">الإقفال الشهري</button><span class="muted">الرصيد السابق يُرحّل دون إضافته للإيراد. الديون والسلف مستمرة.</span></section>`;}
function selectMonth(m){if(!validMonth(m)||m>awtarMonthNow()){alert('اختر شهراً صحيحاً حتى الشهر الحالي');return render();}filterMonth=m;monthFollowCurrent=m===awtarMonthNow();if(monthlyScreen==='cashier')return cashierPage();render();}
let monthlyScreen='tabs';
const renderBeforeMonthly=render;
render=function(){
 monthGeneration++;monthlyScreen='tabs';
 if(monthFollowCurrent)filterMonth=awtarMonthNow();
 renderBeforeMonthly();
 if(profile?.role==='admin')app.insertAdjacentHTML('afterbegin',monthToolbar());
};
const refreshBeforeMonthly=refreshAdmin;
refreshAdmin=async function(){await refreshBeforeMonthly();try{monthlyStatus=await api('/rest/v1/rpc/awtar_month_status',{});monthlyError=null;}catch(e){monthlyStatus=null;monthlyError=e;}};
// Legacy renderers are synchronous; restore the full array even if rendering fails.
function monthView(fn){return function(...args){const all=db.entries;db.entries=monthRows(db,filterMonth);try{return fn.apply(this,args);}finally{db.entries=all;}};}
const ledgerBeforeMonthly=monthView(ledger);
ledger=function(type){
 const root=document.createElement('div');root.innerHTML=ledgerBeforeMonthly(type);
 const locked=monthLocked(filterMonth);
 root.querySelectorAll('form').forEach(f=>{
 const date=f.querySelector('[name=date]');if(date){date.value=monthDate(filterMonth);date.setAttribute('value',date.value);date.max=today();date.setAttribute('min',filterMonth+'-01');date.setAttribute('max',filterMonth===awtarMonthNow()?today():monthEnd(filterMonth));}
 if(locked)f.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);
 });
 if(locked){root.querySelectorAll('button.danger').forEach(b=>b.disabled=true);root.insertAdjacentHTML('afterbegin','<p class="notice">هذا الشهر مقفول. افتحه من الإقفال الشهري بواسطة المدير لتصحيح حركاته.</p>');}
 return root.innerHTML+`<div class="actions no-print"><button onclick="printLedger('${type}')">طباعة كشف الشهر</button></div>`;
};
printLedger=monthView(printLedger);
home=function(){const a=monthAmounts(db,filterMonth),p=awtarCashPosition(db);return `<section class="panel"><h2>ملخص ${esc(filterMonth)}</h2>${revenueSummary(a.rows)}</section>${monthlyBalances(a)}<section class="panel"><h2>الصندوق والعهدة الآن — جميع الحركات</h2><div class="cards">${stat('رصيد الصندوق الآن',p.main)}${stat('بعهدة الصرف الآن',p.held)}${stat('النقد الكلي الآن',p.total)}</div></section><section class="panel"><h2>عمليات الشهر</h2>${entryTable(a.rows.slice().sort((x,y)=>y.date.localeCompare(x.date)),false)}</section>`;};
function monthlyBalances(a){return `<section class="panel"><h2>الأرصدة المرحلة</h2><div class="cards">${stat('افتتاحي النقد: الصندوق والعهدة',a.openingCash)}${stat('افتتاحي الماستر',a.openingMaster)}${stat('نقد نهاية الفترة: الصندوق والعهدة',a.openingCash+a.cash)}${stat('ماستر نهاية الفترة',a.openingMaster+a.master)}</div><p class="muted">الأرصدة مبنية على الحركات المسجلة. النقد يشمل عهدة الصرف؛ تخصيص العهدة وإرجاعها تحويل داخلي. فرق الإيرادات والمصروفات ليس الربح النهائي.</p></section>`;}
report=function(){return `<section class="panel"><h2>تقرير العمليات المالية</h2><form onsubmit="event.preventDefault();showReport()"><div><label>من تاريخ</label><input id="from" type="date" value="${filterMonth}-01" required></div><div><label>إلى تاريخ</label><input id="to" type="date" value="${monthDate(filterMonth)}" required></div><button>عرض التقرير</button></form></section><section id="reportResult" class="panel"></section>`;};
function monthlyLanding(){const g=monthGeneration;queueMicrotask(()=>{if(g===monthGeneration&&tab==='monthly')monthlyPage();});return '<section class="panel"><p role="status">جارٍ تحميل الإقفال الشهري…</p></section>';}
async function monthlyPage(){
 if(profile?.role!=='admin')return;
 const g=++monthGeneration,m=filterMonth,uid=session?.user?.id;busy(true);
 try{
 await refreshAdmin();if(g!==monthGeneration||uid!==session?.user?.id||profile?.role!=='admin')return;
 if(!monthlyStatus)throw monthlyError||Error('تعذر قراءة حالة الإقفال');
 const status=monthlyStatus,a=monthAmounts(db,m),past=m<status.current_month,opened=status.reopened.some(x=>x.month===m),locked=past&&!opened;
 app.innerHTML=monthToolbar()+`<section class="panel"><h2>الإقفال الشهري — ${esc(m)}</h2><p class="notice">${locked?'الشهر مقفول ومحفوظ.':past?'الشهر مفتوح لتصحيح المدير؛ أعد إقفاله بعد الانتهاء.':'الشهر الحالي مفتوح، ويقفل تلقائياً عند بداية الشهر التالي بتوقيت بغداد.'}</p><p>الشهر الجديد يبدأ بإيرادات ومصروفات صفر، مع استمرار أرصدة النقد والماستر والديون والسلف. لا تُحذف أي حركة.</p><div class="actions"><button onclick="printMonth()">طباعة كشف الشهر</button>${past?`<button onclick="toggleMonth(${!opened})">${opened?'إعادة إقفال الشهر':'فتح الشهر للتصحيح — مدير'}</button>`:''}</div></section><section class="panel">${revenueSummary(a.rows)}</section>${monthlyBalances(a)}<section class="panel"><h2>الحركات المالية</h2>${entryTable(a.rows,false)}</section><section class="panel"><h2>سجل فتح وإقفال الأشهر</h2>${status.audit.map(x=>`<p>${esc(x.month)} — ${x.opened?'فتح للتصحيح':'إقفال'} — ${esc(x.reason)} — ${esc(new Date(x.created_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'}))}</p>`).join('')||'<p>لا توجد تصحيحات مسجلة.</p>'}</section>`;
 }catch(e){if(g!==monthGeneration||uid!==session?.user?.id)return;const missing=/PGRST202|awtar_month_status|schema cache|does not exist/.test(e.message);app.innerHTML=monthToolbar()+`<section class="panel"><h2>${missing?'تفعيل الإقفال الشهري':'تعذر تحميل الإقفال الشهري'}</h2><p>${missing?'شغّل ملف monthly-setup.sql مرة واحدة في قاعدة البيانات لتفعيل الحماية بين الأجهزة.':'تحقق من الاتصال وصلاحية جلسة الدخول ثم أعد المحاولة.'}</p><p>لم يتم حذف أو تصفير بياناتك.</p><p class="muted">${esc(e.message)}</p><button onclick="monthlyPage()">إعادة المحاولة</button></section>`;}finally{busy(false);}
}
async function toggleMonth(opened){const m=filterMonth;if(profile?.role!=='admin'||!validMonth(m)||m>=awtarMonthNow())return;const reason=prompt(opened?'سبب فتح الشهر للتصحيح:':'سبب إعادة الإقفال:');if(!reason?.trim())return;if(reason.trim().length>300)return alert('اكتب سبباً لا يتجاوز 300 حرف');busy(true);try{await api('/rest/v1/rpc/awtar_month_toggle',{target_month:m,make_open:opened,reason:reason.trim()});await monthlyPage();}catch(e){alert(e.message);}finally{busy(false);}}
function printMonth(){const a=monthAmounts(db,filterMonth);openStatement('كشف شهر '+filterMonth,revenueSummary(a.rows)+monthlyBalances(a)+entryTable(a.rows,false));}
const cashierBeforeMonthly=cashierPage;
cashierPage=function(){cashierBeforeMonthly();if(profile?.role!=='admin')return;monthlyScreen='cashier';monthGeneration++;app.insertAdjacentHTML('afterbegin',monthToolbar());const f=document.getElementById('cashierForm');if(f){f.elements.date.value=monthDate(filterMonth);f.elements.date.min=filterMonth+'-01';f.elements.date.max=monthDate(filterMonth);if(monthLocked(filterMonth))f.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=true);}const rows=app.querySelectorAll('tbody tr');rows.forEach(row=>{const text=row.cells[0]?.textContent;if(text&&/^\d{2}\/\d{2}\/\d{4}$/.test(text)){const m=text.slice(6)+'-'+text.slice(3,5);if(m!==filterMonth)row.remove();else if(monthLocked(m))row.querySelectorAll('button').forEach(b=>b.disabled=true);}});const body=app.querySelector('tbody');if(body&&!body.children.length)body.innerHTML='<tr><td colspan=8>لا توجد مطابقات لهذا الشهر</td></tr>';};
// Fail early for closed or future dates; the database remains authoritative.
const addEntryBeforeMonthly=addEntry;
addEntry=function(ev,type){const d=new FormData(ev.target).get('date');if(!d||d>today()||monthLocked(d.slice(0,7))){ev.preventDefault();return alert('التاريخ مستقبلي أو الشهر مقفول؛ افتح الشهر للتصحيح أولاً.');}return addEntryBeforeMonthly(ev,type);};
// A lost response can follow a successful commit. Verify before reporting failure.
function monthCanonical(value){if(Array.isArray(value))return '['+value.map(monthCanonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+monthCanonical(value[k])).join(',')+'}';return JSON.stringify(value);}
let monthPendingSave=null;
save=function(){
 if(profile?.role!=='admin'){alert('غير مخوّل');return false;}
 if(monthPendingSave){db=structuredClone(monthPendingSave.next);return false;}
 const next=structuredClone(db),expected=revision,uid=session?.user?.id,pending={next};monthPendingSave=pending;busy(true);
 (async()=>{
 try{const r=await api('/rest/v1/rpc/awtar_save',{body:next,expected});if(uid===session?.user?.id&&profile?.role==='admin'){revision=r;db=structuredClone(next);committed=structuredClone(next);render();}}
 catch(e){if(uid!==session?.user?.id||profile?.role!=='admin')return;db=structuredClone(committed);let confirmed=false;try{await refreshAdmin();confirmed=monthCanonical(db)===monthCanonical(next);}catch(_){}
 alert(confirmed?'تم التحقق: العملية محفوظة رغم انقطاع الرد. لا تعِد إدخالها.':'تعذر تأكيد الحفظ: '+e.message+' — راجع السجل بعد التحديث قبل إعادة الإدخال.');render();}
 finally{if(monthPendingSave===pending)monthPendingSave=null;busy(false);}
 })();return true;
};
function monthHasDraft(){return [...app.querySelectorAll('form input,form textarea')].some(el=>el.type==='file'?el.files.length>0:!['hidden','submit','button'].includes(el.type)&&el.value!==el.defaultValue)||[...app.querySelectorAll('form select')].some(el=>el.selectedIndex!==Math.max(0,[...el.options].findIndex(o=>o.defaultSelected)));}
function followMonthRollover(){if(profile?.role==='admin'&&monthFollowCurrent&&filterMonth!==awtarMonthNow()){
 if(monthHasDraft()){monthFollowCurrent=false;if(!document.getElementById('monthRolloverNotice'))app.insertAdjacentHTML('afterbegin','<p id="monthRolloverNotice" class="notice no-print">بدأ شهر جديد. احتفظنا بالنموذج غير المحفوظ؛ راجع تاريخه قبل التسجيل أو تغيير الشهر.</p>');return;}
 filterMonth=awtarMonthNow();if(monthlyScreen==='cashier')cashierPage();else render();
}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)followMonthRollover();});window.addEventListener('focus',followMonthRollover);
setInterval(followMonthRollover,60000);
// Boot may finish before this optional script downloads. Hydrate status in that case.
if(profile?.role==='admin'){
 render();const uid=session?.user?.id;
 api('/rest/v1/rpc/awtar_month_status',{}).then(status=>{if(uid!==session?.user?.id||profile?.role!=='admin'||monthlyStatus)return;monthlyStatus=status;monthlyError=null;if(monthlyScreen==='tabs'&&tab!=='monthly'&&!monthHasDraft()&&!monthPendingSave)render();}).catch(e=>{if(!monthlyStatus)monthlyError=e;});
}

'use strict';
let cfg=window.AWTAR_CONFIG||JSON.parse(localStorage.getItem('awtar_cloud_config')||'null'), session=JSON.parse(sessionStorage.getItem('awtar_session')||'null'), profile=null, revision=0, committed=null, materials=[],accounts=[];
const app=document.getElementById('app'),nav=document.getElementById('nav');
function busy(on){let el=document.getElementById('busy');if(on&&!el){el=document.createElement('div');el.id='busy';el.textContent='جارٍ الحفظ…';el.style='position:fixed;inset:0;background:#ffffffdd;z-index:10000;display:grid;place-items:center';document.body.append(el)}if(!on)el?.remove()}
async function api(path,body,method){const r=await fetch(cfg.url+path,{method:method||(body?'POST':'GET'),headers:{apikey:cfg.key,Authorization:'Bearer '+(session?.access_token||cfg.key),'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json().catch(()=>null);if(!r.ok)throw Error(v?.message||v?.error_description||'تعذر الاتصال');return v}
function gate(){nav.innerHTML='';app.innerHTML=`<section class="panel"><h2>دخول الإدارة والموظفين</h2><p>الحفظ مشترك والصلاحيات تُطبّق بقاعدة البيانات.</p><form id="login"><div><label>اسم المستخدم</label><input name="username" autocomplete="username" autocapitalize="none" dir="ltr" pattern="[a-zA-Z][a-zA-Z0-9_.-]{2,31}" required></div><div><label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required></div><button>دخول</button></form><details ${cfg?'class="hidden"':''} style="margin-top:20px"><summary>إعداد الربط أول مرة</summary><p>أدخل رابط مشروع Supabase والمفتاح العام publishable أو anon فقط. لا تدخل مفتاح service_role.</p><form id="config"><div><label>رابط المشروع</label><input name="url" type="url" value="${esc(cfg?.url||'')}" required></div><div><label>المفتاح العام</label><input name="key" value="${esc(cfg?.key||'')}" required></div><button>حفظ الربط</button></form></details><p class="notice">بياناتك القديمة باقية على جهازك. يستطيع المدير استيرادها بعد تسجيل الدخول. راجع ملف تعليمات التفعيل المرفق.</p></section>`;
document.getElementById('config').onsubmit=e=>{e.preventDefault();let f=new FormData(e.target),url=f.get('url').replace(/\/$/,'');if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))return alert('أدخل رابط مشروع Supabase الصحيح');const key=f.get('key').trim();try{const payload=JSON.parse(atob(key.split('.')[1]));if(payload.role==='service_role')return alert('هذا مفتاح سري! استخدم المفتاح العام فقط')}catch(_){}if(key.startsWith('sb_secret_'))return alert('استخدم المفتاح العام فقط');cfg={url,key};localStorage.setItem('awtar_cloud_config',JSON.stringify(cfg));alert('تم حفظ الربط')};
document.getElementById('login').onsubmit=async e=>{e.preventDefault();if(!cfg)return alert('أكمل إعداد الربط أولاً');busy(true);try{const f=new FormData(e.target);session=await api('/functions/v1/awtar-auth',{action:'login',username:f.get('username'),password:f.get('password')});sessionStorage.setItem('awtar_session',JSON.stringify(session));await boot()}catch(x){alert(x.message)}finally{busy(false)}}}
async function boot(){if(!cfg||!session)return gate();try{if(session.refresh_token){session=await api('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});sessionStorage.setItem('awtar_session',JSON.stringify(session))}const rows=await api('/rest/v1/awtar_users?user_id=eq.'+encodeURIComponent(session.user.id)+'&select=*');profile=rows[0];if(!profile)throw Error('حسابك غير مخوّل؛ يضيفك المدير من إدارة المستخدمين');materials=await api('/rest/v1/awtar_materials?select=*&order=name');if(profile.role==='admin'){await refreshAdmin();render()}else await employee()}catch(x){session=null;sessionStorage.removeItem('awtar_session');gate();alert(x.message)}}
async function refreshAdmin(){const [s]=await api('/rest/v1/awtar_state?id=eq.1&select=*');db=s.data;revision=s.revision;committed=structuredClone(db)}
function logout(){session=null;profile=null;sessionStorage.removeItem('awtar_session');closeStatement();gate()}
const renderLocal=render;
render=function(){if(profile?.role!=='admin')return;renderLocal();nav.insertAdjacentHTML('beforeend','<button onclick="management()">الإعدادات — المواد والحسابات والسجل</button><button onclick="reloadCloud()">تحديث</button><button onclick="logout()">خروج</button>')};
async function reloadCloud(){busy(true);try{await refreshAdmin();render()}catch(x){alert(x.message)}finally{busy(false)}}
save=function(){if(profile?.role!=='admin'){alert('غير مخوّل');return false}const next=structuredClone(db);busy(true);api('/rest/v1/rpc/awtar_save',{body:next,expected:revision}).then(r=>{revision=r;committed=next;render()}).catch(async x=>{db=structuredClone(committed);alert('لم يُحفظ التغيير: '+x.message+' — سيتم تحديث البيانات؛ أعد إدخال التغيير.');try{await refreshAdmin()}catch(_){}render()}).finally(()=>busy(false));return true};
async function employee(){accounts=await api('/rest/v1/rpc/awtar_accounts',{});nav.innerHTML='<button onclick="employee().catch(x=>alert(x.message))">تحديث الحسابات</button><button onclick="logout()">خروج</button>';app.innerHTML=`<section class="panel"><h2>أهلاً ${esc(profile.name)}</h2><p>صلاحيتك: تسجيل سحب مواد وتسديد مبالغ فقط. لا يمكن تعديل العمليات أو حذفها.</p><form id="movement"><div><label>الحساب</label><select name="party" required>${accounts.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — المتبقي ${fmt(p.balance)}</option>`).join('')}</select></div><div><label>العملية</label><select name="operation" id="operation"><option value="withdraw">سحب مواد</option><option value="pay">تسديد مبلغ</option></select></div><div id="materialBox"><label>المادة والسعر الثابت</label><select name="material">${materials.filter(m=>m.active).map(m=>`<option value="${m.id}">${esc(m.name)} — ${fmt(m.price)}</option>`).join('')}</select></div><div id="quantityBox"><label>الكمية</label><input name="quantity" type="number" min="1" max="100000" step="1" value="1"></div><div id="paymentBox" class="hidden"><label>مبلغ التسديد</label><input name="payment" type="number" min="1" step="1"></div><button>مراجعة وتسجيل</button></form><p class="muted">التاريخ والوقت واسم الموظف تُسجّل تلقائياً. الأسعار يحددها المدير.</p></section>`;
const form=document.getElementById('movement');document.getElementById('operation').onchange=e=>{const pay=e.target.value==='pay';['materialBox','quantityBox'].forEach(k=>document.getElementById(k).classList.toggle('hidden',pay));document.getElementById('paymentBox').classList.toggle('hidden',!pay)};
form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),op=f.get('operation'),qty=Number(f.get('quantity')),pay=Number(f.get('payment')),mat=materials.find(m=>m.id===f.get('material')),account=accounts.find(p=>p.id===f.get('party'));if(!account)return alert('اختر حساباً');if(op==='withdraw'&&(!mat||!Number.isSafeInteger(qty)||qty<1))return alert('اختر المادة والكمية');if(op==='pay'&&(!Number.isSafeInteger(pay)||pay<1||pay>account.balance))return alert('مبلغ التسديد غير صحيح أو أكبر من الرصيد');if(!confirm(account.name+'\n'+(op==='pay'?'تسديد '+fmt(pay):mat.name+' × '+qty+' = '+fmt(mat.price*qty))+'\nتأكيد التسجيل؟'))return;const payload={request_id:crypto.randomUUID(),party_id:account.id,operation:op,material_id:op==='withdraw'?mat.id:null,quantity:op==='withdraw'?qty:null,payment:op==='pay'?pay:null};busy(true);try{await api('/rest/v1/rpc/awtar_record',payload);alert('تم تسجيل العملية');await employee()}catch(x){alert('تعذر تأكيد العملية. حدّث الحساب وتحقق من رصيده قبل تكرار التسجيل. '+x.message)}finally{busy(false)}}}
async function management(){if(profile?.role!=='admin')return;busy(true);try{const users=await api('/rest/v1/awtar_users?select=*'),audit=await api('/rest/v1/awtar_audit?select=*&order=created_at.desc&limit=100');materials=await api('/rest/v1/awtar_materials?select=*&order=name');app.innerHTML=`<section class="panel"><h2>المواد والأسعار</h2><form id="mat"><div><label>اسم المادة</label><input name="name" required maxlength="100"></div>${moneyField}<button>إضافة مادة</button></form>${materials.map(m=>`<p>${esc(m.name)} — ${fmt(m.price)} — ${m.active?'متاحة':'موقوفة'} <button onclick="toggleMaterial('${m.id}',${!m.active})">${m.active?'إيقاف':'تفعيل'}</button></p>`).join('')}</section><section class="panel"><h2>إضافة موظف</h2><p>أنشئ حساب الموظف هنا. صلاحياته ثابتة: سحب مواد وتسديد فقط.</p><form id="user"><div><label>اسم المستخدم</label><input name="username" dir="ltr" autocapitalize="none" pattern="[a-zA-Z][a-zA-Z0-9_.-]{2,31}" required></div><div><label>كلمة المرور</label><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><div><label>اسم الموظف</label><input name="name" required maxlength="100"></div><button>تخويل للسحب والتسديد فقط</button></form>${users.map(u=>`<p>${esc(u.name)} (${esc(u.username||'')}) — ${u.role==='admin'?'مدير':'موظف'} ${u.role==='employee'?`<button class="danger" onclick="revokeUser('${u.user_id}')">إيقاف الصلاحية</button>`:''}</p>`).join('')}</section><section class="panel"><h2>نقل بيانات الجهاز القديمة</h2><button onclick="importOld()">استيراد البيانات المحفوظة بهذا المتصفح</button><p>أو استخدم النسخ الاحتياطي لاستيراد ملف JSON. يتم الاستيراد فقط إذا كانت القاعدة المشتركة فارغة.</p></section><section class="panel"><h2>سجل الرقابة — آخر 100 عملية</h2>${audit.map(a=>`<p>${esc(new Date(a.created_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'}))} | ${esc(a.actor_name)} | ${esc(a.action)} | ${esc(a.payload.note||'')} ${a.payload.amount?fmt(a.payload.amount):''}</p>`).join('')}</section>`;
document.getElementById('mat').onsubmit=e=>adminAction(async()=>{e.preventDefault();const f=new FormData(e.target),price=Number(f.get('amount'));if(!Number.isSafeInteger(price)||price<1)throw Error('السعر غير صحيح');await api('/rest/v1/awtar_materials',{name:f.get('name').trim(),price,active:true})});document.getElementById('user').onsubmit=e=>adminAction(async()=>{e.preventDefault();const f=new FormData(e.target);await api('/functions/v1/awtar-auth',{action:'create',username:f.get('username').trim(),password:f.get('password'),name:f.get('name').trim()});alert('تم إنشاء حساب الموظف')});}catch(x){alert(x.message)}finally{busy(false)}}
async function adminAction(fn){if(profile?.role!=='admin')return;busy(true);try{await fn();await management()}catch(x){alert(x.message)}finally{busy(false)}}
function toggleMaterial(mid,active){adminAction(()=>api('/rest/v1/awtar_materials?id=eq.'+mid,{active},'PATCH'))}
function revokeUser(uid){if(confirm('إيقاف صلاحية الموظف؟'))adminAction(()=>api('/rest/v1/awtar_users?user_id=eq.'+uid,null,'DELETE'))}
function importOld(){if(profile?.role!=='admin')return;if(db.entries.length||db.parties.length)return alert('القاعدة المشتركة غير فارغة. تم منع الاستبدال');const old=JSON.parse(localStorage.getItem(KEY)||'null');if(!validDB(old))return alert('لا توجد بيانات قديمة صالحة هنا. استخدم ملف النسخة الاحتياطية من جهازك القديم');if(confirm('نقل بيانات هذا المتصفح إلى القاعدة المشتركة؟')){db=old;save()}}
const restoreBeforeCloud=restore;restore=async function(){if(profile?.role!=='admin')return;if(db.entries.length||db.parties.length)return alert('الاستيراد متاح عندما تكون القاعدة المشتركة فارغة فقط');await restoreBeforeCloud()};
const backupBeforeCloud=backup;backup=function(){return backupBeforeCloud().replace('البيانات محفوظة داخل متصفح هذا الجهاز فقط، وقد تُفقد عند مسح بيانات Safari أو استخدام التصفح الخاص. النسخة لا تحتوي على تسجيل دخول أو مزامنة بين الأجهزة.','البيانات محفوظة في قاعدة البيانات المشتركة. البيانات القديمة بهذا الجهاز تبقى محفوظة حتى تستوردها. لا تشارك حساب المدير.')};
boot();
restore=async function(){if(profile?.role!=='admin')return;if(db.entries.length||db.parties.length)return alert('الاستيراد متاح عندما تكون القاعدة المشتركة فارغة فقط');const file=document.getElementById('restore').files[0];if(!file)return alert('اختر ملف النسخة');busy(true);try{const incoming=JSON.parse(await file.text());if(!validDB(incoming))throw Error('النسخة غير صالحة');if(!confirm('استيراد البيانات إلى القاعدة المشتركة؟'))return;await api('/rest/v1/rpc/awtar_save',{body:incoming,expected:revision});await refreshAdmin();render();alert('تم الاستيراد والحفظ')}catch(x){alert('لم يتم تأكيد الاستيراد: '+x.message)}finally{busy(false)}};
const adminRenderWithSettings = render;
render = function () {
  adminRenderWithSettings();
  if (profile?.role === 'admin')
    nav.insertAdjacentHTML('afterbegin',
      '<button onclick="sharedDaily()">الصرفيات اليومية</button>');
};

const employeeWithMovements = employee;
employee = async function () {
  await employeeWithMovements();
  nav.insertAdjacentHTML('afterbegin',
    '<button onclick="sharedDaily()">الصرفيات اليومية</button>');
};

let dailyPoll = null;

async function sharedDaily() {
  if (!profile) return;
  clearInterval(dailyPoll);
  busy(true);
  try {
    const data = await api('/rest/v1/rpc/awtar_cash_summary', {});
    app.innerHTML = `
      <section class="panel">
        <h2>الصرفيات اليومية</h2>
        <p>الرصيد الافتتاحي 3,000,000 دينار، وكل صرف ينخصم منه.</p>
        <button onclick="sharedDaily()">تحديث</button>
        <div class="cards" id="fundTotals">${sharedTotals(data)}</div>
        <p id="fundSync">تم التحديث</p>
      </section>
      <section class="panel">
        <h2>تسجيل صرف</h2>
        <form id="cloudSpend">
          <div><label>المادة / وجه الصرف</label>
            <input name="item" required maxlength="100"></div>
          <div><label>التفاصيل</label>
            <input name="details" required maxlength="300"></div>
          <div><label>المبلغ بالدينار</label>
            <input name="amount" type="number" min="1" step="1" required></div>
          <button>حفظ وخصم المبلغ</button>
        </form>
      </section>
      <section class="panel">
        <h2>سجل الصرفيات</h2>
        <div id="fundRows">${sharedRows(data)}</div>
      </section>
      ${profile.role === 'admin' ? `
      <section class="panel">
        <h2>زيادة الرصيد — للمدير</h2>
        <form id="cloudTopup">
          <div><label>المبلغ</label>
            <input name="amount" type="number" min="1" step="1" required></div>
          <div><label>البيان</label>
            <input name="details" required maxlength="300"></div>
          <button>زيادة الرصيد</button>
        </form>
      </section>` : ''}`;

    document.getElementById('cloudSpend').onsubmit =
      e => recordFund(e, 'spend');
    const top = document.getElementById('cloudTopup');
    if (top) top.onsubmit = e => recordFund(e, 'topup');
    dailyPoll = setInterval(refreshFund, 10000);
  } catch (x) {
    alert(x.message);
  } finally {
    busy(false);
  }
}

function sharedTotals(d) {
  return stat('إجمالي المخصص', d.funded) +
    stat('إجمالي المصروف', d.spent) +
    stat('الصافي المتبقي', d.remaining);
}

function sharedRows(d) {
  return `<div class="scroll"><table>
    <thead><tr>
      <th>التاريخ</th><th>المادة</th><th>التفاصيل</th>
      <th>المبلغ</th><th>الموظف</th>
    </tr></thead><tbody>
    ${d.entries.slice().reverse().map(e => `
      <tr>
        <td>${datefmt(e.date)}</td>
        <td>${esc(e.category)}</td>
        <td>${esc(e.note)}</td>
        <td>${fmt(e.amount)}</td>
        <td>${esc(e.actorName)}</td>
      </tr>`).join('') ||
      '<tr><td colspan="5">لا توجد صرفيات</td></tr>'}
    </tbody></table></div>`;
}

async function refreshFund() {
  if (!profile || !document.getElementById('fundTotals')) {
    clearInterval(dailyPoll);
    return;
  }
  try {
    const d = await api('/rest/v1/rpc/awtar_cash_summary', {});
    if (!document.getElementById('fundTotals')) return;
    document.getElementById('fundTotals').innerHTML = sharedTotals(d);
    document.getElementById('fundRows').innerHTML = sharedRows(d);
    document.getElementById('fundSync').textContent =
      'آخر تحديث: ' + new Date().toLocaleTimeString('ar-IQ');
  } catch (_) {
    const el = document.getElementById('fundSync');
    if (el) el.textContent = 'تعذر التحديث؛ تحقق من الاتصال أو سجل دخولك مجدداً';
  }
}

async function recordFund(e, operation) {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const amount = Number(f.get('amount'));
  if (!Number.isSafeInteger(amount) || amount < 1)
    return alert('المبلغ غير صحيح');
  if (!confirm('تأكيد ' +
      (operation === 'spend' ? 'صرف ' : 'إضافة ') + fmt(amount)))
    return;

  busy(true);
  try {
    await api('/rest/v1/rpc/awtar_cash_record', {
      request_id: crypto.randomUUID(),
      operation,
      amount,
      item: operation === 'spend' ? f.get('item') : 'تعزيز رصيد',
      details: f.get('details')
    });
    form.reset();
    if (profile.role === 'admin') await refreshAdmin();
    await refreshFund();
    alert('تم الحفظ في الحساب المشترك');
  } catch (x) {
    alert('لم يتم تأكيد الحفظ: ' + x.message +
      '؛ تحقق من السجل قبل تكرار العملية');
  } finally {
    busy(false);
  }// تحديث التاريخ والحذف وكشف اليوم
function awtarToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = type => parts.find(p => p.type === type).value;
  return value('year') + '-' + value('month') + '-' + value('day');
}

const dailyBeforeDate = sharedDaily;
sharedDaily = async function () {
  await dailyBeforeDate();
  const form = document.getElementById('cloudSpend');
  if (!form) return;

  if (!form.elements.expense_date) {
    const box = document.createElement('div');
    box.innerHTML = `
      <label>تاريخ المصروف</label>
      <input type="date" name="expense_date" required>`;
    box.querySelector('input').value = awtarToday();
    form.prepend(box);
  }

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = `
    <h2>كشف صرفيات يوم</h2>
    <label>تاريخ الكشف</label>
    <input id="dailyReportDate" type="date">
    <button onclick="loadDailyReport()">عرض الكشف</button>
    <div id="dailyReportBody"></div>`;
  app.append(panel);
  document.getElementById('dailyReportDate').value = awtarToday();
  await loadDailyReport();
};

const rowsBeforeDelete = sharedRows;
sharedRows = function (d) {
  const html = rowsBeforeDelete(d);
  if (profile?.role !== 'admin') return html;

  const box = document.createElement('div');
  box.innerHTML = html;
  const head = document.createElement('th');
  head.textContent = 'حذف';
  box.querySelector('thead tr').append(head);

  const entries = d.entries.slice().reverse();
  box.querySelectorAll('tbody tr').forEach((row, i) => {
    if (!entries[i]) return;
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'حذف';
    button.setAttribute(
      'onclick',
      'deleteDailyExpense(' + JSON.stringify(entries[i].id) + ')'
    );
    cell.append(button);
    row.append(cell);
  });
  return box.innerHTML;
};

recordFund = async function (e, operation) {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const amount = Number(f.get('amount'));
  const date = operation === 'spend'
    ? f.get('expense_date') : awtarToday();

  if (!Number.isSafeInteger(amount) || amount < 1)
    return alert('المبلغ غير صحيح');
  if (!date) return alert('حدد تاريخ المصروف');
  if (!confirm('تأكيد ' +
      (operation === 'spend' ? 'صرف ' : 'إضافة ') + fmt(amount)))
    return;

  busy(true);
  try {
    await api('/rest/v1/rpc/awtar_cash_record_dated', {
      request_id: crypto.randomUUID(),
      operation,
      amount,
      item: operation === 'spend' ? f.get('item') : 'تعزيز رصيد',
      details: f.get('details'),
      expense_date: date
    });

    form.reset();
    if (form.elements.expense_date)
      form.elements.expense_date.value = date;
    if (profile.role === 'admin') await refreshAdmin();
    await refreshFund();
    alert('تم الحفظ');
  } catch (x) {
    alert('لم يتم تأكيد الحفظ: ' + x.message +
      '؛ تحقق من السجل قبل التكرار');
  } finally {
    busy(false);
  }
};

async function deleteDailyExpense(id) {
  if (profile?.role !== 'admin') return;
  if (!confirm('حذف هذا المصروف وإرجاع مبلغه للرصيد؟')) return;
  busy(true);
  try {
    await api('/rest/v1/rpc/awtar_cash_delete', {
      request_id: crypto.randomUUID(),
      entry_id: id
    });
    await refreshAdmin();
    await refreshFund();
    alert('تم الحذف وإرجاع المبلغ للرصيد');
  } catch (x) {
    alert(x.message);
  } finally {
    busy(false);
  }
}

let currentDailyReport = null;
let dailyReportRequest = 0;

function makeDailyReport(d, date) {
  const sum = list => list.reduce(
    (total, e) => total + Number(e.amount), 0
  );
  const rows = d.entries.filter(e => e.date === date);
  const opening = 3000000 +
    sum((d.topups || []).filter(e => e.date < date)) -
    sum(d.entries.filter(e => e.date < date));
  const topups = sum((d.topups || []).filter(e => e.date === date));
  const spent = sum(rows);
  return {
    date, rows, opening, topups, spent,
    closing: opening + topups - spent
  };
}

async function loadDailyReport() {
  const date = document.getElementById('dailyReportDate')?.value;
  if (!date) return;
  const request = ++dailyReportRequest;
  try {
    const d = await api('/rest/v1/rpc/awtar_cash_summary', {});
    const body = document.getElementById('dailyReportBody');
    if (!body || request !== dailyReportRequest ||
        document.getElementById('dailyReportDate').value !== date)
      return;

    currentDailyReport = makeDailyReport(d, date);
    body.innerHTML = reportDailyHTML(currentDailyReport) + `
      <p>
        <button onclick="printDailyReport()">طباعة الكشف</button>
        <button onclick="whatsappDailyReport()">إرسال عبر الواتساب</button>
      </p>`;
  } catch (e) {
    currentDailyReport = null;
    const body = document.getElementById('dailyReportBody');
    if (body) body.textContent = 'تعذر تحميل الكشف: ' + e.message;
  }
}

function reportDailyHTML(r) {
  return `
    <h2>مطعم وكافيه أوتار</h2>
    <h3>كشف الصرفيات اليومية — ${esc(r.date)}</h3>
    <p>الرصيد قبل اليوم: ${fmt(r.opening)}</p>
    <p>تعزيز الرصيد خلال اليوم: ${fmt(r.topups)}</p>
    ${rowsBeforeDelete({ entries: r.rows })}
    <p><strong>مجموع صرف اليوم: ${fmt(r.spent)}</strong></p>
    <p><strong>الرصيد بنهاية اليوم: ${fmt(r.closing)}</strong></p>
    <small>حسب العمليات الموجودة وقت إعداد الكشف</small>`;
}

function selectedDailyReport() {
  const date = document.getElementById('dailyReportDate')?.value;
  if (!currentDailyReport || currentDailyReport.date !== date) {
    alert('اضغط عرض الكشف أولاً');
    return null;
  }
  return currentDailyReport;
}

function whatsappDailyReport() {
  const r = selectedDailyReport();
  if (!r) return;
  const text = [
    'مطعم وكافيه أوتار',
    'كشف صرفيات ' + r.date,
    'الرصيد قبل اليوم: ' + fmt(r.opening),
    'تعزيز اليوم: ' + fmt(r.topups),
    ...r.rows.map((e, i) =>
      (i + 1) + '. ' + e.category +
      ' — ' + e.note +
      ' — ' + fmt(e.amount) +
      ' — ' + e.actorName
    ),
    r.rows.length ? '' : 'لا توجد صرفيات بهذا اليوم',
    'مجموع الصرف: ' + fmt(r.spent),
    'المتبقي بنهاية اليوم: ' + fmt(r.closing)
  ].filter(Boolean).join('\n');

  window.open(
    'https://wa.me/?text=' + encodeURIComponent(text),
    '_blank', 'noopener'
  );
}

function printDailyReport() {
  const r = selectedDailyReport();
  if (!r) return;
  document.getElementById('dailyPrintFrame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'dailyPrintFrame';
  frame.style =
    'position:fixed;width:1px;height:1px;left:-10000px;border:0';
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };
  frame.srcdoc = `
    <!doctype html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8">
      <title>كشف الصرفيات اليومية</title>
      <style>
        body {font:14px Arial;padding:20px;color:#111}
        table {border-collapse:collapse;width:100%}
        td,th {
          border:1px solid #999;padding:8px;
          text-align:right;overflow-wrap:anywhere
        }
        h2 {text-align:center}
        @page {size:A4;margin:12mm}
      </style>
    </head>
    <body>${reportDailyHTML(r)}</body>
    </html>`;
  document.body.append(frame);
}

const refreshBeforeReport = refreshFund;
refreshFund = async function () {
  await refreshBeforeReport();
  if (document.getElementById('dailyReportBody'))
    await loadDailyReport();
};
}

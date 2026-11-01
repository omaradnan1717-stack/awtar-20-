'use strict';
const ledgerBeforeShifts=ledger;
ledger=function(type){return (type==='income'?'<section class="panel"><h2>مطابقة الكاشير</h2><div class="actions"><button onclick="cashierPage()">مطابقة وترحيل الإيرادات</button><button onclick="cashierShifts()">حسابات الكاشير والشفتات</button></div></section>':'')+ledgerBeforeShifts(type);};
const employeeBeforeShifts=employee;
employee=async function(){if(profile?.role==='cashier')return cashierShifts();return employeeBeforeShifts();};
const renderBeforeShifts=render;
render=function(){renderBeforeShifts();if(profile?.role==='admin')nav.insertAdjacentHTML('afterbegin','<button onclick="cashierShifts()">حسابات الكاشير والشفتات</button>');};
async function cashierShifts(){
 if(!['admin','cashier'].includes(profile?.role))return;
 clearInterval(dailyPoll);busy(true);
 try{
 const [users,rows]=await Promise.all([api('/rest/v1/rpc/awtar_cashier_users',{}),api('/rest/v1/awtar_cashier_shifts?select=*&order=created_at.desc')]);
 const admin=profile.role==='admin',name=k=>users.find(u=>u.id===k)?.name||k;
 if(!admin)nav.innerHTML='<button onclick="cashierShifts()">تحديث الشفت</button><button onclick="logout()">خروج</button>';
 const active=rows.find(r=>r.cashier===session.user.id&&!r.closed),pending=rows.filter(r=>r.closed&&r.next_cashier===session.user.id&&r.retained>0&&!rows.some(s=>s.source_id===r.id));
 app.innerHTML=`<section class="panel"><h2>${admin?'إدارة حسابات الكاشير':'أهلاً '+esc(profile.name)}</h2><p>الإيرادات = مبيعات الشفت فقط. النقد المطلوب تسليمه = الرصيد الافتتاحي + المبيعات الكلية − الماستر − المبلغ المتروك.</p></section>`;
 if(admin){
 const all=await api('/rest/v1/awtar_users?select=user_id,name,role,username');
 app.insertAdjacentHTML('beforeend',`<section class="panel"><h2>إضافة حساب كاشير</h2><form id="newCashier"><div><label>الاسم</label><input name="name" maxlength="100" required></div><div><label>اسم الدخول</label><input name="username" pattern="[a-z][a-z0-9_.-]{2,31}" dir="ltr" autocapitalize="none" required></div><div><label>كلمة المرور</label><input name="password" type="password" minlength="12" maxlength="128" required></div><button>إنشاء حساب كاشير</button></form><p class="muted">يمكن تخصيص حساب موظف موجود للكاشير؛ تتحول واجهته إلى الشفتات.</p>${all.filter(u=>u.role==='employee').map(u=>`<p>${esc(u.name)} <button data-cashier-enable="${esc(u.user_id)}">تخصيص للكاشير</button></p>`).join('')}</section>`);
 document.getElementById('newCashier').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await cashierAction(async()=>{
 await api('/functions/v1/awtar-auth',{action:'create',username:f.get('username').trim(),password:f.get('password'),name:f.get('name').trim()});
 const found=await api('/rest/v1/awtar_users?username=eq.'+encodeURIComponent(f.get('username').trim())+'&select=user_id');if(found.length!==1)throw Error('الحساب أُنشئ؛ خصّصه للكاشير من قائمة الموظفين');
 await api('/rest/v1/awtar_users?user_id=eq.'+found[0].user_id,{role:'cashier'},'PATCH');
 });};
 app.querySelectorAll('[data-cashier-enable]').forEach(b=>b.onclick=()=>{if(confirm('تخصيص هذا الحساب للكاشير؟'))cashierAction(()=>api('/rest/v1/awtar_users?user_id=eq.'+b.dataset.cashierEnable,{role:'cashier'},'PATCH'));});
 }else if(active){
 app.insertAdjacentHTML('beforeend',`<section class="panel"><h2>الشفت المفتوح: ${esc(active.label)}</h2><h3>الرصيد المستلم: ${fmt(active.opening)}</h3><form id="closeCashier"><div><label>المبيعات الكلية دون الرصيد الافتتاحي</label><input name="total" type="number" min="0" step="1" required></div><div><label>الماستر</label><input name="master" type="number" min="0" step="1" value="0" required></div><div><label>المبلغ المتروك للكاشير التالي</label><input name="retained" type="number" min="0" step="1" value="0" required></div><div><label>الكاشير التالي</label><select name="next"><option value="">بدون تسليم</option>${users.filter(u=>u.id!==session.user.id).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></div><div><label>المطلوب تسليمه للإدارة</label><output id="cashierDelivery">—</output></div><button>إغلاق الشفت وترحيل الإيرادات</button></form></section>`);
 const form=document.getElementById('closeCashier');
 form.oninput=()=>{const f=new FormData(form),t=Number(f.get('total')),m=Number(f.get('master')),r=Number(f.get('retained')),delivery=Number(active.opening)+t-m-r;document.getElementById('cashierDelivery').textContent=[t,m,r].every(Number.isSafeInteger)&&t>=m&&m>=0&&r>=0&&delivery>=0?fmt(delivery):'تحقق من المبالغ';};
 form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),p={id:active.id,total:Number(f.get('total')),master:Number(f.get('master')),retained:Number(f.get('retained')),next:f.get('next')};if(![p.total,p.master,p.retained].every(Number.isSafeInteger)||p.total<p.master||p.master<0||p.retained<0||p.retained>Number(active.opening)+p.total-p.master)return alert('تحقق من المبالغ');if(!confirm('تأكيد إغلاق الشفت وترحيل الإيراد؟'))return;cashierAction(()=>api('/rest/v1/rpc/awtar_cashier_shift',{action:'close',p}));};
 }else{
 const requestId=crypto.randomUUID();
 app.insertAdjacentHTML('beforeend',`<section class="panel"><h2>بدء شفت وتأكيد الاستلام</h2><form id="openCashier"><div><label>التاريخ</label><input name="date" type="date" value="${today()}" required></div><div><label>اسم / رقم الشفت</label><input name="label" maxlength="50" required></div><div><label>المبلغ المستلم من الشفت السابق</label><select name="source"><option value="">بدون رصيد مستلم — صفر</option>${pending.map(r=>`<option value="${r.id}">${esc(name(r.cashier))} — ${fmt(r.retained)} — ${datefmt(r.work_date)}</option>`).join('')}</select></div><button>تأكيد الاستلام وفتح الشفت</button></form></section>`);
 document.getElementById('openCashier').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);cashierAction(()=>api('/rest/v1/rpc/awtar_cashier_shift',{action:'open',p:{id:requestId,date:f.get('date'),label:f.get('label').trim(),source:f.get('source')}}));};
 }
 app.insertAdjacentHTML('beforeend',`<section class="panel"><h2>سجل الشفتات</h2><div class="scroll"><table><tr><th>الكاشير / التاريخ</th><th>الشفت</th><th>المستلم</th><th>المبيعات</th><th>الماستر</th><th>المتروك</th><th>المسلّم للإدارة</th><th>الحالة</th></tr>${rows.map(r=>`<tr><td>${esc(name(r.cashier))}<br>${datefmt(r.work_date)}</td><td>${esc(r.label)}</td><td>${fmt(r.opening)}</td><td>${r.closed?fmt(r.total):'—'}</td><td>${r.closed?fmt(r.master):'—'}</td><td>${r.closed?fmt(r.retained)+'<br>'+esc(r.next_cashier?name(r.next_cashier):''):'—'}</td><td>${r.closed?fmt(Number(r.opening)+Number(r.total)-Number(r.master)-Number(r.retained)):'—'}</td><td>${r.closed?'مغلق':'مفتوح'}</td></tr>`).join('')}</table></div></section>`);
 }catch(e){alert('تعذر فتح حسابات الكاشير: '+e.message+' — تأكد من تشغيل ملف cashier-shifts.sql أول مرة.');}finally{busy(false);}
}
async function cashierAction(fn){busy(true);try{await fn();await cashierShifts();}catch(e){alert('لم يتم تأكيد العملية: '+e.message+' — حدّث السجل قبل إعادة المحاولة.');}finally{busy(false);}}
const removeEntryBeforeShiftLock=removeEntry;
removeEntry=function(k){if(db.entries.find(e=>e.id===k)?.shiftId)return alert('هذا الإيراد مرتبط بشفت مغلق؛ احتفظ به للسجل وسجّل أي تصحيح بقيد تسوية موضح السبب.');return removeEntryBeforeShiftLock(k);};

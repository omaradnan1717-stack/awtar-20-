'use strict';
// Uses the existing revision-checked state transaction: both revenues commit together.
const renderBeforeCashier = render;
render = function() {
  renderBeforeCashier();
  if (profile?.role === 'admin') nav.insertAdjacentHTML('afterbegin','<button onclick="cashierPage()">مطابقة الكاشير</button>');
};
function cashierGroups() {
  return db.entries.filter(e=>e.cashierMatch).map(e=>e.cashierMatch);
}
function parseMasterReceipts(text) {
  const digits = text.replace(/[٠-٩۰-۹]/g, digit =>
    String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
  const amounts = digits.split(/[\n+;؛]/).map(amount => amount.trim()).filter(Boolean);
  let total = 0;
  for (const amount of amounts) {
    if (!/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(amount)) return null;
    const value = Number(amount.replace(/[,٬]/g, ''));
    total += value;
    if (value <= 0 || !Number.isSafeInteger(total)) return null;
  }
  return { count: amounts.length, total };
}
function cashierPage() {
  if (profile?.role !== 'admin') return;
  clearInterval(dailyPoll);
  const rows = cashierGroups().sort((a,b)=>b.date.localeCompare(a.date));
  app.innerHTML = `<section class="panel"><h2>مطابقة الكاشير</h2><p>الكلي − الماستر − دخول الكاشير = الصافي النقدي. الحفظ يرحّل الإيرادين معاً.</p><form id="cashierForm"><div><label>اسم الكاشير</label><input name="cashier" maxlength="100" required list="cashierNames"><datalist id="cashierNames">${[...new Set(rows.map(r=>r.cashier))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist></div><div><label>التاريخ</label><input name="date" type="date" value="${today()}" required></div><div><label>الشفت / رقم الوجبة</label><input name="shift" value="1" maxlength="50" required></div><div><label>المبيعات الكلية (د.ع)</label><input name="total" type="number" min="1" step="1" required></div><div><label>الماستر (د.ع)</label><input name="master" type="number" min="0" step="1" value="0" required><details style="margin-top:8px"><summary>جمع وصولات الماستر</summary><label for="masterReceipts">اكتب أو الصق مبلغ كل وصل بسطر مستقل</label><textarea id="masterReceipts" rows="4" style="width:100%;font:inherit" placeholder="5000&#10;12500&#10;20000"></textarea><p id="masterReceiptStatus" class="muted" role="status"></p></details></div><div><label>دخول الكاشير (د.ع)</label><input name="opening" type="number" min="0" step="1" value="0" required></div><div><label>الصافي النقدي</label><output id="cashierNet" style="display:block;padding:11px;font-weight:bold">—</output></div><button type="submit">حفظ وترحيل المطابقة</button></form><p id="cashierStatus" role="status"></p></section><section class="panel"><h2>المطابقات المستقلة</h2><div class="scroll"><table><thead><tr><th>التاريخ</th><th>الكاشير</th><th>الشفت</th><th>الكلي</th><th>دخول الكاشير</th><th>صافي النقدي</th><th>ماستر</th><th>إجراء</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${datefmt(r.date)}</td><td>${esc(r.cashier)}</td><td>${esc(r.shift)}</td><td>${fmt(r.total)}</td><td>${fmt(r.opening||0)}</td><td>${fmt(r.total-r.master-(r.opening||0))}</td><td>${fmt(r.master)}</td><td><button class="danger" onclick="deleteCashierMatch('${esc(r.id)}')">إلغاء المطابقة</button></td></tr>`).join('')||'<tr><td colspan="8">لا توجد مطابقات</td></tr>'}</tbody></table></div><p class="notice">كل كاشير مستقل. عند وجود أكثر من وجبة لنفس الكاشير في اليوم، استخدم رقم شفت مختلفاً. لا تسجّل هذه المبيعات مرة ثانية يدوياً بالإيرادات. الإلغاء يحذف إيرادي المطابقة معاً.</p></section>`;
  const form=document.getElementById('cashierForm');
  const receiptInput = document.getElementById('masterReceipts');
  const receiptStatus = document.getElementById('masterReceiptStatus');
  const masterInput = form.elements.master;
  const updateNet = ()=>{const t=Number(form.elements.total.value),m=Number(form.elements.master.value),o=Number(form.elements.opening.value);document.getElementById('cashierNet').textContent=Number.isSafeInteger(t)&&Number.isSafeInteger(m)&&Number.isSafeInteger(o)&&o>=0&&m>=0&&t-m>=o?fmt(t-m-o):'تحقق من المبالغ';};
  let manualMaster = masterInput.value;
  function updateMasterReceipts() {
    const hasReceipts = Boolean(receiptInput.value.trim());
    const result = parseMasterReceipts(receiptInput.value);
    if (!masterInput.readOnly) manualMaster = masterInput.value;
    masterInput.readOnly = hasReceipts;
    const error = hasReceipts && !result?.count ? 'تأكد من مبالغ الوصولات. اكتب مبلغ كل وصل بسطر مستقل.' : '';
    receiptInput.setCustomValidity(error);
    masterInput.value = hasReceipts ? (error ? '' : String(result.total)) : manualMaster;
    receiptStatus.textContent = error || (hasReceipts ? result.count + ' وصل — المجموع ' + fmt(result.total) : '');
    updateNet();
    if (error) document.getElementById('cashierNet').textContent = 'تحقق من مبالغ الوصولات';
    return !error;
  }
  receiptInput.addEventListener('input', updateMasterReceipts);
  form.oninput = event => { if (event.target !== receiptInput) updateNet(); };
  form.onsubmit=async ev=>{
    ev.preventDefault();
    if (!updateMasterReceipts()) return receiptInput.reportValidity();
    const f=new FormData(form),cashier=String(f.get('cashier')).trim().replace(/\s+/g,' '),shift=String(f.get('shift')).trim(),date=f.get('date'),total=Number(f.get('total')),master=Number(f.get('master')),opening=Number(f.get('opening'));
    if(!cashier||!shift||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(master)||master<0||master>total||!Number.isSafeInteger(opening)||opening<0||opening>total-master)return alert('تحقق من الاسم والتاريخ والمبالغ؛ مجموع الماستر ودخول الكاشير لا يتجاوز الكلي');
    if(total-opening===0)return alert('الصافي والماستر صفر؛ لا يوجد إيراد لترحيله');
    const status=document.getElementById('cashierStatus');
    busy(true);
    try {
      await refreshAdmin();
      if(cashierGroups().some(r=>r.date===date&&r.cashier===cashier&&r.shift===shift))throw Error('هذه المطابقة مرحّلة سابقاً لنفس الكاشير والتاريخ والشفت');
      const match={id:id(),cashier,shift,date,total,master,opening}, next=structuredClone(db),created=Date.now();
      const newRows=[{amount:total-master-opening,method:'نقدي'},{amount:master,method:'ماستر كارد'}].filter(e=>e.amount>0).map(e=>({...e,id:id(),type:'income',created,date,category:'مبيعات الكاشير',note:'مطابقة '+cashier+' — شفت '+shift+' — دخول الكاشير '+opening,cashierMatchId:match.id}));
      newRows[0].cashierMatch=match;
      next.entries.push(...newRows);
      const newRevision=await api('/rest/v1/rpc/awtar_save',{body:next,expected:revision});
      db=next;committed=structuredClone(next);revision=newRevision;
      cashierPage();document.getElementById('cashierStatus').textContent='تم حفظ المطابقة وترحيل النقدي والماستر ✅';
    } catch(error) {
      // Refresh after ambiguous responses: a committed match will block a retry.
      try{await refreshAdmin();}catch(_){}
      status.textContent='لم يتم تأكيد الحفظ: '+error.message+' — عند إعادة المحاولة يتم فحص التكرار أولاً.';
    } finally {busy(false);}
  };
}
async function deleteCashierMatch(matchId) {
  if(profile?.role!=='admin'||!confirm('إلغاء المطابقة وحذف الإيراد النقدي وإيراد الماستر المرتبطين بها؟'))return;
  busy(true);
  try {
    await refreshAdmin();
    if(!cashierGroups().some(r=>r.id===matchId))throw Error('المطابقة غير موجودة؛ حدّث السجل');
    const next=structuredClone(db);next.entries=next.entries.filter(e=>e.cashierMatchId!==matchId);
    const newRevision=await api('/rest/v1/rpc/awtar_save',{body:next,expected:revision});
    db=next;committed=structuredClone(next);revision=newRevision;cashierPage();
  }catch(e){alert('لم يتم تأكيد الإلغاء: '+e.message);try{await refreshAdmin();cashierPage();}catch(_){}}finally{busy(false);}
}
const removeEntryBeforeCashier=removeEntry;
removeEntry=function(key){const e=db.entries.find(e=>e.id===key);if(e?.cashierMatchId)return deleteCashierMatch(e.cashierMatchId);return removeEntryBeforeCashier(key);};

const ledgerBeforeSimpleMatch=ledger;
ledger=function(type){return (type==='income'?'<section class="panel"><button onclick="cashierPage()">مطابقة الكاشير</button></section>':'')+ledgerBeforeSimpleMatch(type);};

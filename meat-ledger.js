'use strict';
(() => {
  const employeeName = 'hamdan.1177';
  const endpoint = '/rest/v1/awtar_meat_purchases';
  const canEnter = () => profile?.role === 'employee' && profile.username === employeeName;
  const isAdmin = () => profile?.role === 'admin';
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 3});
  const supplierKey = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const paymentKind = 'تسديد لحوم';
  const paymentMethods = ['نقدي', 'ماستر كارد'];
  const finance = window.awtarMeatFinance;
  let pendingPayment = null;
  const paymentsIn = state => state.entries.filter(row => row.type === 'expense' && typeof row.meatPaymentSupplier === 'string' && row.meatPaymentSupplier);
  const purchaseSum = rows => rows.reduce((total,row) => total + Number(row.total),0);
  const paymentSum = rows => rows.reduce((total,row) => total + Number(row.amount),0);
  const matchSupplier = (name, choice) => !choice || supplierKey(name) === choice;

  function meatTotals(purchases, payments, selected, choice) {
    const buys = purchases.filter(row => matchSupplier(row.supplier, choice));
    const paid = payments.filter(row => matchSupplier(row.meatPaymentSupplier, choice));
    const purchaseRows = buys.filter(row => row.purchase_date.slice(0,7) === selected);
    const paymentRows = paid.filter(row => row.date.slice(0,7) === selected);
    const opening = purchaseSum(buys.filter(row => row.purchase_date.slice(0,7) < selected)) -
      paymentSum(paid.filter(row => row.date.slice(0,7) < selected));
    return {purchaseRows, paymentRows, opening, remaining: opening + purchaseSum(purchaseRows) - paymentSum(paymentRows)};
  }

  function paymentLimit(purchases, payments, choice, date) {
    const buys = purchases.filter(row => matchSupplier(row.supplier, choice));
    const paid = payments.filter(row => matchSupplier(row.meatPaymentSupplier, choice));
    const balanceAt = day => purchaseSum(buys.filter(row => row.purchase_date <= day)) -
      paymentSum(paid.filter(row => row.date <= day));
    // A backdated payment must also leave enough to cover already posted later payments.
    return Math.max(0, [...new Set(paid.filter(row => row.date > date).map(row => row.date))]
      .reduce((min, day) => Math.min(min, balanceAt(day)), balanceAt(date)));
  }

  async function loadPurchases(end, alive = () => true) {
    const query = '?select=id,purchase_date,supplier,kg,price_per_kg,total,note&order=purchase_date.desc,id.desc&purchase_date=lte.' + end + '&limit=500';
    const rows = [];
    let page;
    do {
      page = await api(endpoint + query + '&offset=' + rows.length);
      if (!alive()) return null;
      rows.push(...page);
    } while (page.length === 500);
    return [...new Map(rows.map(row => [row.id,row])).values()];
  }

  function addButton() {
    if ((!canEnter() && !isAdmin()) || nav.querySelector('[data-meat-ledger]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.meatLedger = '';
    button.textContent = 'سجل اللحوم';
    button.onclick = () => openLedger();
    const logoutButton = nav.querySelector('button[onclick="logout()"]');
    nav.insertBefore(button, logoutButton);
  }

  const previousRender = render;
  render = function () {
    previousRender.apply(this, arguments);
    addButton();
  };
  const previousEmployee = employee;
  employee = async function () {
    await previousEmployee.apply(this, arguments);
    addButton();
  };

  function openLedger(filters = {}) {
    if (!canEnter() && !isAdmin()) return;
    const owner = isAdmin();
    app.innerHTML = owner ? `
      <section class="panel"><h2>سجل اللحوم بالآجل</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px 18px">
        <div role="group" aria-label="الشهر والسنة" style="display:grid;grid-template-columns:1fr 1.3fr;gap:8px;min-width:0">
          <label style="min-width:0">الشهر<select id="meatMonth" dir="ltr" style="min-width:0">${Array.from({length:12}, (_, i) => {
            const value = String(i + 1).padStart(2,'0');
            return `<option value="${value}"${today().slice(5,7) === value ? ' selected' : ''}>${value}</option>`;
          }).join('')}</select></label>
          <label style="min-width:0">السنة<input id="meatYear" type="number" dir="ltr" inputmode="numeric" min="1900" max="9998" step="1" value="${today().slice(0,4)}" required style="min-width:0"></label>
        </div>
        <label style="min-width:0">المجهّز<select id="meatSupplier" style="min-width:0"><option value="">كل المجهّزين</option></select></label>
      </div>
      <button type="button" id="meatRefresh" style="margin-top:10px">تحديث الكشف</button>
      <div id="meatRows" aria-live="polite"></div></section>` : `
      <section class="panel"><h2>تسجيل شراء لحوم بالآجل</h2>
      <form id="meatForm">
      <label>تاريخ الشراء<input name="date" type="date" value="${today()}" required></label>
      <label>المجهّز<input name="supplier" maxlength="100" required></label>
      <label>الكمية (كغم)<input name="kg" type="number" min=".001" max="10000" step=".001" inputmode="decimal" required></label>
      <label>سعر الكيلو (دينار)<input name="price" type="number" min="1" max="100000000" step="1" inputmode="numeric" required></label>
      <label>رقم الوصل أو ملاحظة<input name="note" maxlength="300"></label>
      <div><div class="actions"><button type="button" id="meatScan">سكنر الوصل</button><button type="button" id="meatPick">اختيار صورة</button><button type="button" id="meatRemove" hidden>إزالة الصورة</button></div>
      <input name="camera" type="file" accept="image/*" capture="environment" hidden>
      <input name="picker" type="file" accept="image/*" hidden>
      <p id="meatPhotoStatus" class="muted" role="status">صوّر الوصل على سطح غامق حتى يطلع القص أوضح.</p>
      <img id="meatPreview" alt="معاينة الوصل" style="max-width:100%;max-height:320px" hidden></div>
      <output id="meatTotal" class="notice">مبلغ الشراء ${fmt(0)}</output>
      <button type="submit">حفظ بالآجل</button><p id="meatStatus" role="status"></p></form></section>`;
    if (owner) bindReport(filters);
    else bindEntry();
  }

  function bindEntry() {
    const form = document.getElementById('meatForm');
    const fields = form.elements;
    const el = id => form.querySelector('#' + id);
    const submit = form.querySelector('[type=submit]');
    let photo = '';
    let readingPhoto = false;
    let sending = false;
    let pending = null;
    const getAmount = () => Math.round((fields.kg.valueAsNumber || 0) * (fields.price.valueAsNumber || 0));
    const update = () => { el('meatTotal').textContent = 'مبلغ الشراء ' + fmt(getAmount()); };
    const setPhoto = value => {
      photo = value;
      const preview = el('meatPreview');
      if (value) preview.src = value;
      else preview.removeAttribute('src');
      preview.hidden = !value;
      el('meatRemove').hidden = !value;
    };
    fields.kg.oninput = fields.price.oninput = update;
    el('meatScan').onclick = () => fields.camera.click();
    el('meatPick').onclick = () => fields.picker.click();
    el('meatRemove').onclick = () => {
      if (readingPhoto || sending) return;
      setPhoto('');
      el('meatPhotoStatus').textContent = 'تمت إزالة الصورة.';
    };
    for (const input of [fields.camera, fields.picker]) input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (!file || readingPhoto || sending) return;
      readingPhoto = submit.disabled = true;
      el('meatPhotoStatus').textContent = 'جارٍ تجهيز الوصل…';
      try {
        const {data, cropped} = await preparePhoto(file, input === fields.camera);
        setPhoto(data);
        el('meatPhotoStatus').textContent = cropped ? 'تم قص الوصل. راجع المعاينة.' : 'راجع صورة الوصل قبل الحفظ.';
      } catch (error) {
        el('meatPhotoStatus').textContent = error.message;
      } finally {
        readingPhoto = submit.disabled = false;
      }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (!canEnter() || readingPhoto || sending) return;
      const status = el('meatStatus');
      if (!fields.supplier.value.trim() || getAmount() < 1 || !photo) {
        status.textContent = 'أدخل اسم المجهّز ومبلغ شراء صحيح وأرفق صورة الوصل.';
        return;
      }
      const record = {
        purchase_date: fields.date.value, supplier: fields.supplier.value.trim(), meat_type: 'لحوم',
        kg: fields.kg.valueAsNumber, price_per_kg: fields.price.valueAsNumber,
        note: fields.note.value.trim(), receipt: photo
      };
      const fingerprint = JSON.stringify(record);
      if (pending && pending.fingerprint !== fingerprint) {
        status.textContent = 'تعذّر تأكيد الحفظ السابق. أعد نفس البيانات حتى نتحقق منه قبل تسجيل وصل جديد.';
        return;
      }
      pending ||= {id: id(), fingerprint};
      sending = submit.disabled = true;
      status.textContent = 'جارٍ حفظ الشراء…';
      try {
        try {
          await api(endpoint, {...record, id: pending.id});
        } catch (error) {
          const confirmed = await api(endpoint + '?select=id&id=eq.' + encodeURIComponent(pending.id));
          if (!confirmed.length) {
            pending = null;
            throw error;
          }
        }
        pending = null;
        const date = fields.date.value;
        const supplier = fields.supplier.value;
        form.reset();
        fields.date.value = date;
        fields.supplier.value = supplier;
        setPhoto('');
        update();
        el('meatPhotoStatus').textContent = 'صوّر الوصل التالي أو اختَر صورته.';
        status.textContent = 'تم حفظ الشراء بالآجل.';
      } catch (error) {
        status.textContent = 'تعذّر تأكيد الحفظ: ' + error.message;
      } finally {
        sending = submit.disabled = false;
      }
    };
  }

  function bindReport(filters) {
    const month = document.getElementById('meatMonth');
    const year = document.getElementById('meatYear');
    const supplier = document.getElementById('meatSupplier');
    const list = document.getElementById('meatRows');
    if (filters.selected) {
      [year.value, month.value] = filters.selected.split('-');
    }
    let records = [], payments = [], generation = 0, observer, loadedMonth = '', sending = false;
    let chosenSupplier = filters.supplier || '';
    const openDays = new Map();
    const totalKg = rows => rows.reduce((total, row) => total + Math.round(Number(row.kg) * 1000), 0) / 1000;
    const totalAmount = purchaseSum;
    function dailyLedger(rows) {
      const currentDay = today();
      const days = new Map();
      if (loadedMonth === currentDay.slice(0,7)) days.set(currentDay, []);
      for (const row of rows) {
        if (!days.has(row.purchase_date)) days.set(row.purchase_date, []);
        days.get(row.purchase_date).push(row);
      }
      return [...days.keys()].sort().reverse().map(day => {
        const purchases = days.get(day);
        return `<details class="daily-ledger-day" data-meat-day="${esc(day)}"${(openDays.get(day) ?? day === currentDay) ? ' open' : ''}>
          <summary><strong>${day === currentDay ? 'اليوم · ' : ''}${esc(datefmt(day))}</strong>
          <span style="display:inline-flex;flex-wrap:wrap;gap:4px 10px"><span>${number.format(totalKg(purchases))} كغم</span><span>${fmt(totalAmount(purchases))}</span></span></summary>
          <div style="padding:0 10px">${purchases.map(row => `<article style="padding:12px 0;border-top:1px solid #e4ecea">
            <h3>${esc(row.supplier || 'بدون اسم مجهّز')}</h3>
            <p>${number.format(row.kg)} كغم × ${fmt(row.price_per_kg)} · <strong>${fmt(row.total)}</strong></p>
            ${row.note ? '<p>' + esc(row.note) + '</p>' : ''}
            <div data-meat-receipt="${esc(row.id)}">جارٍ تحميل صورة الوصل…</div></article>`).join('') || '<p>ماكو قيود لهذا اليوم.</p>'}</div>
          </details>`;
      }).join('') || '<p>ماكو قيود لهالشهر.</p>';
    }
    function paint() {
      observer?.disconnect();
      const {purchaseRows: rows, paymentRows, opening, remaining} = meatTotals(records, payments, loadedMonth, supplier.value);
      const options = Array.from(supplier.options).filter(option => option.value).map(option =>
        '<option value="' + esc(option.value) + '"' + (option.value === supplier.value ? ' selected' : '') + '>' + esc(option.textContent) + '</option>').join('');
      list.innerHTML = `<div class="cards" style="margin:14px 0">
      <div class="stat">إجمالي الوزن<b>${number.format(totalKg(rows))} كغم</b></div>
      ${stat('رصيد من الأشهر السابقة', opening)}
      ${stat('مشتريات الشهر بالآجل', totalAmount(rows))}
      ${stat('تسديدات الشهر', paymentSum(paymentRows))}
      ${stat('المتبقي بذمتك', remaining)}</div>
      <h3>تسديد اللحوم</h3>
      <p class="muted">سجّل دفعة اللحوم هنا فقط. ما تحتاج تضيفها مرة ثانية بالمصروفات أو بحساب المجهّز العام.</p>
      ${options ? `<form id="meatPaymentForm">
        <label>المجهّز<select name="paySupplier" required><option value="">اختَر المجهّز</option>${options}</select></label>
        <label>تاريخ التسديد<input name="payDate" type="date" value="${today()}" max="${today()}" required></label>
        <label>مبلغ التسديد (دينار)<input name="payAmount" type="number" min="1" step="1" inputmode="numeric" required></label>
        <label>طريقة الدفع<select name="payMethod">${paymentMethods.map(method => '<option>' + method + '</option>').join('')}</select></label>
        <label>ملاحظة<input name="payNote" maxlength="200"></label>
        <p id="meatPayBalance" class="muted"></p>
        <button type="submit">حفظ التسديد وترحيله للمصروفات</button>
        <p id="meatPayStatus" role="status">${esc(filters.message || '')}</p></form>` : '<p>يظهر التسديد بعد تسجيل مشتريات أول مجهّز.</p>'}
      <h3>سجل تسديدات الشهر</h3>
      ${paymentRows.length ? '<div class="scroll"><table><thead><tr><th>التاريخ</th><th>المجهّز</th><th>المبلغ</th><th>الطريقة</th></tr></thead><tbody>' +
        paymentRows.slice().sort((a,b) => b.date.localeCompare(a.date) || b.created - a.created).map(row =>
          '<tr><td>' + esc(datefmt(row.date)) + '</td><td>' + esc(row.meatPaymentSupplier) + '</td><td>' + fmt(row.amount) + '</td><td>' + esc(row.method) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p>ماكو تسديدات لهذا الشهر.</p>'}
      <h3>سجل المشتريات اليومي</h3>` + dailyLedger(rows);
      bindPaymentForm();
      for (const day of list.querySelectorAll('[data-meat-day]')) {
        day.addEventListener('toggle', () => {
          if (day.isConnected) openDays.set(day.dataset.meatDay, day.open);
        });
      }
      async function showPhoto(target) {
        try {
          const [row] = await api(endpoint + '?select=receipt&id=eq.' + encodeURIComponent(target.dataset.meatReceipt));
          if (!row?.receipt || !/^data:image\/jpeg;base64,/.test(row.receipt)) {
            target.textContent = 'لا توجد صورة للوصل.';
            return;
          }
          const image = document.createElement('img');
          image.alt = 'صورة وصل الشراء';
          image.style.cssText = 'display:block;max-width:100%;max-height:400px';
          image.src = row.receipt;
          target.replaceChildren(image);
        } catch {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'إعادة تحميل صورة الوصل';
          retry.onclick = () => showPhoto(target);
          target.replaceChildren(retry);
        }
      }
      if ('IntersectionObserver' in window) observer = new IntersectionObserver(items => {
        for (const item of items) if (item.isIntersecting) {
          observer.unobserve(item.target);
          showPhoto(item.target);
        }
      }, {rootMargin:'240px'});
      for (const target of list.querySelectorAll('[data-meat-receipt]')) {
        if (observer) observer.observe(target);
        else {
          const day = target.closest('details');
          const load = () => {
            if (!day.open) return;
            day.removeEventListener('toggle', load);
            showPhoto(target);
          };
          day.addEventListener('toggle', load);
          load();
        }
      }
    }
    function bindPaymentForm() {
      const form = list.querySelector('#meatPaymentForm');
      if (!form) return;
      const {paySupplier, payDate, payAmount, payMethod, payNote} = form.elements;
      const status = form.querySelector('#meatPayStatus');
      const maxDisplay = form.querySelector('#meatPayBalance');
      const submit = form.querySelector('[type=submit]');
      const showLimit = () => {
        maxDisplay.textContent = paySupplier.value && payDate.value ?
          'المتاح للتسديد بهذا التاريخ: ' + fmt(paymentLimit(records, payments, paySupplier.value, payDate.value)) : '';
      };
      paySupplier.onchange = payDate.onchange = showLimit;
      showLimit();
      form.onsubmit = async event => {
        event.preventDefault();
        if (!isAdmin() || sending) return;
        const ownerId = session?.user?.id;
        if (!ownerId) return;
        if (pendingPayment?.ownerId !== ownerId) pendingPayment = null;
        const choice = paySupplier.value, date = payDate.value, amount = payAmount.valueAsNumber;
        const name = paySupplier.selectedOptions[0]?.textContent, method = payMethod.value, note = payNote.value.trim();
        if (!choice || !name || !Number.isSafeInteger(amount) || amount < 1 || !paymentMethods.includes(method)) {
          status.textContent = 'أدخل المجهّز وطريقة الدفع ومبلغاً صحيحاً.';
          return;
        }
        const fingerprint = JSON.stringify([choice,date,amount,method,note]);
        const attempt = pendingPayment && pendingPayment.fingerprint === fingerprint ? pendingPayment : {fingerprint, key: id(), ownerId};
        sending = submit.disabled = true;
        busy(true);
        let attempted = false;
        const finished = () => openLedger({selected: loadedMonth, supplier: choice, message: 'تم تسجيل ' + fmt(amount) + ' وترحيله للمصروفات بتاريخ ' + datefmt(date) + '.'});
        try {
          await refreshAdmin();
          if (pendingPayment && db.entries.some(row => row.id === pendingPayment.key)) {
            if (pendingPayment.key === attempt.key) { finished(); return; }
            pendingPayment = null;
            payments = paymentsIn(db);
            showLimit();
            status.textContent = 'تم تأكيد التسديد السابق. راجع الرصيد المحدّث واضغط الحفظ مجدداً للتسديد الجديد.';
            return;
          }
          pendingPayment = null;
          finance.ensureDate(date);
          const freshPurchases = await loadPurchases(today());
          if (!isAdmin() || !form.isConnected) return;
          // Read the revision again after the purchase history. The save uses the existing
          // compare-and-swap revision guard, so a concurrent payment cannot be overwritten.
          await refreshAdmin();
          if (!isAdmin() || !form.isConnected) return;
          const limit = paymentLimit(freshPurchases, paymentsIn(db), choice, date);
          maxDisplay.textContent = 'المتاح للتسديد بهذا التاريخ: ' + fmt(limit);
          if (amount > limit) throw Error('مبلغ التسديد أعلى من المتبقي لهذا المجهّز بهذا التاريخ.');
          if (!confirm('ترحيل ' + fmt(amount) + ' إلى المصروفات وتسديده من حساب ' + name + '؟')) return;
          const next = structuredClone(db);
          // The expense is the payment record; there is no second write or duplicate cash entry.
          next.entries.push({id: attempt.key, type: 'expense', created: Date.now(), date, amount, method,
            category: paymentKind, note: 'تسديد لحوم: ' + name + (note ? ' · ' + note : ''), meatPaymentSupplier: name});
          pendingPayment = attempt;
          attempted = true;
          await finance.commitAccounts(next);
          pendingPayment = null;
          finished();
        } catch (error) {
          if (attempted && isAdmin()) {
            try {
              await refreshAdmin();
              if (db.entries.some(row => row.id === attempt.key)) { pendingPayment = null; finished(); return; }
            } catch (_) {}
          }
          if (form.isConnected) status.textContent = error.message;
          else alert(error.message);
        } finally {
          sending = submit.disabled = false;
          busy(false);
        }
      };
    }
    async function refresh() {
      if (!isAdmin() || sending) return;
      if (!year.reportValidity()) return;
      const selected = year.valueAsNumber + '-' + month.value;
      const ticket = ++generation;
      observer?.disconnect();
      list.textContent = 'جارٍ تحديث السجل…';
      try {
        const [year, value] = selected.split('-').map(Number);
        const end = selected + '-' + new Date(Date.UTC(year,value,0)).getUTCDate();
        const active = () => ticket === generation && list.isConnected && isAdmin();
        const result = await loadPurchases(end > today() ? end : today(), active);
        if (!active()) return;
        await refreshAdmin();
        if (!active()) return;
        loadedMonth = selected;
        records = result;
        payments = paymentsIn(db);
        const names = new Map();
        for (const name of [...result.map(row => row.supplier), ...payments.map(row => row.meatPaymentSupplier)]) {
          if (supplierKey(name) && !names.has(supplierKey(name))) names.set(supplierKey(name), name);
        }
        supplier.replaceChildren(new Option('كل المجهّزين', ''), ...[...names].sort((a,b) => a[1].localeCompare(b[1],'ar')).map(([key,name]) => new Option(name,key)));
        if (names.has(chosenSupplier)) supplier.value = chosenSupplier;
        paint();
      } catch (error) {
        if (ticket === generation) list.textContent = 'تعذّر تحميل السجل: ' + error.message;
      }
    }
    month.onchange = year.onchange = document.getElementById('meatRefresh').onclick = refresh;
    supplier.onchange = () => {
      chosenSupplier = supplier.value;
      if (loadedMonth === year.valueAsNumber + '-' + month.value) paint();
    };
    refresh();
  }

  const removeOtherExpense = removeEntry;
  removeEntry = async function (key) {
    const row = db.entries.find(entry => entry.id === key);
    if (!row?.meatPaymentSupplier) return removeOtherExpense.apply(this, arguments);
    if (!isAdmin() || !confirm('إلغاء تسديد اللحوم بقيمة ' + fmt(row.amount) + '؟ سيُحذف المصروف ويعود المبلغ إلى ذمة المجهّز.')) return;
    try {
      await refreshAdmin();
      const current = db.entries.find(entry => entry.id === key);
      if (!current) return render();
      if (current.meatPaymentSupplier !== row.meatPaymentSupplier || current.amount !== row.amount || current.date !== row.date) throw Error('تغيّر التسديد، راجعه قبل الإلغاء.');
      finance.ensureDate(current.date);
      const next = structuredClone(db);
      next.entries = next.entries.filter(entry => entry.id !== key);
      await finance.commitAccounts(next);
    } catch (error) { alert(error.message); }
  };

  async function preparePhoto(file, scan) {
    if (file.size > 15000000) throw Error('اختَر صورة أقل من 15 ميغابايت.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve,reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error('تعذّر فتح الصورة. جرّب تصويرها مرة ثانية.'));
        image.src = url;
      });
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth,image.naturalHeight));
      let canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const bounds = scan && paperBounds(canvas);
      if (bounds) {
        const cropped = document.createElement('canvas');
        cropped.width = bounds[2];
        cropped.height = bounds[3];
        cropped.getContext('2d').drawImage(canvas,...bounds,0,0,cropped.width,cropped.height);
        canvas = cropped;
      }
      let data = canvas.toDataURL('image/jpeg',.78);
      if (data.length > 1800000) data = canvas.toDataURL('image/jpeg',.55);
      if (data.length > 1800000) throw Error('الصورة كبيرة. صوّر الوصل عن قرب وأعد المحاولة.');
      return {data, cropped: Boolean(bounds)};
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function paperBounds(canvas){
 const sample=document.createElement('canvas');
 const ratio=Math.min(1,240/Math.max(canvas.width,canvas.height));
 sample.width=Math.max(1,Math.round(canvas.width*ratio));
 sample.height=Math.max(1,Math.round(canvas.height*ratio));
 const ctx=sample.getContext('2d',{willReadFrequently:true});
 const {width,height}=sample;
 ctx.drawImage(canvas,0,0,width,height);
 const pixels=ctx.getImageData(0,0,width,height).data;
 const rows=new Uint16Array(height);
 const cols=new Uint16Array(width);
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){
   const i=(y*width+x)*4;
   const low=Math.min(pixels[i],pixels[i+1],pixels[i+2]);
   const high=Math.max(pixels[i],pixels[i+1],pixels[i+2]);
   if(low>=165 && high-low<=40){
    rows[y]++;
    cols[x]++;
   }
  }
 }
 const xMin=cols.findIndex(count=>count>=height*.12);
 const xMax=cols.findLastIndex(count=>count>=height*.12);
 const yMin=rows.findIndex(count=>count>=width*.12);
 const yMax=rows.findLastIndex(count=>count>=width*.12);
 const area=(xMax-xMin)*(yMax-yMin);
 if(xMin<0||yMin<0||xMax-xMin<width*.2||yMax-yMin<height*.2||area>width*height*.92) return null;
 const left=Math.max(0,Math.floor((xMin-3)*canvas.width/width));
 const top=Math.max(0,Math.floor((yMin-3)*canvas.height/height));
 const right=Math.min(canvas.width,Math.ceil((xMax+4)*canvas.width/width));
 const bottom=Math.min(canvas.height,Math.ceil((yMax+4)*canvas.height/height));
 return [left,top,right-left,bottom-top];
}
  if (profile) addButton();
})();

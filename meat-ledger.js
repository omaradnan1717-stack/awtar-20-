'use strict';
(() => {
  const employeeName = 'hamdan.1177';
  const endpoint = '/rest/v1/awtar_meat_purchases';
  const canEnter = () => profile?.role === 'employee' && profile.username === employeeName;
  const isAdmin = () => profile?.role === 'admin';
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 3});

  function addButton() {
    if ((!canEnter() && !isAdmin()) || nav.querySelector('[data-meat-ledger]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.meatLedger = '';
    button.textContent = 'سجل اللحوم';
    button.onclick = openLedger;
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

  function openLedger() {
    if (!canEnter() && !isAdmin()) return;
    const owner = isAdmin();
    app.innerHTML = owner ? `
      <section class="panel"><h2>سجل اللحوم بالآجل</h2>
      <div class="actions"><label>الشهر<input id="meatMonth" type="month" value="${today().slice(0,7)}"></label>
      <label>المجهّز<select id="meatSupplier"><option value="">كل المجهّزين</option></select></label>
      <button type="button" id="meatRefresh">تحديث الكشف</button></div>
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
    if (owner) bindReport();
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

  function bindReport() {
    const month = document.getElementById('meatMonth');
    const supplier = document.getElementById('meatSupplier');
    const list = document.getElementById('meatRows');
    let records = [], generation = 0, observer;
    function paint() {
      observer?.disconnect();
      const rows = records.filter(row => !supplier.value || row.supplier === supplier.value);
      const kg = rows.reduce((total, row) => total + Math.round(Number(row.kg) * 1000), 0) / 1000;
      const amount = rows.reduce((total, row) => total + Number(row.total), 0);
      list.innerHTML = `<div class="cards" style="margin:14px 0">
      <div class="stat">إجمالي الوزن<b>${number.format(kg)} كغم</b></div>
      ${stat('مستحق مشتريات الشهر بالآجل', amount)}</div>` +
        (rows.map(row => `<article class="panel" style="border:1px solid #dce9e6">
        <h3>${esc(row.supplier || 'بدون اسم مجهّز')}</h3><p>${esc(datefmt(row.purchase_date))} ·
        ${number.format(row.kg)} كغم × ${fmt(row.price_per_kg)} · <strong>${fmt(row.total)}</strong></p>
        ${row.note ? '<p>' + esc(row.note) + '</p>' : ''}
        <div data-meat-receipt="${esc(row.id)}">جارٍ تحميل صورة الوصل…</div></article>`).join('') || '<p>ماكو قيود لهالشهر.</p>');
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
        else showPhoto(target);
      }
    }
    async function refresh() {
      if (!isAdmin()) return;
      const selected = month.value;
      if (!/^\d{4}-\d{2}$/.test(selected)) return;
      const ticket = ++generation;
      observer?.disconnect();
      list.textContent = 'جارٍ تحديث السجل…';
      try {
        const [year, value] = selected.split('-').map(Number);
        const next = value === 12 ? (year + 1) + '-01' : year + '-' + String(value + 1).padStart(2, '0');
        const query = '?select=id,purchase_date,supplier,kg,price_per_kg,total,note&order=purchase_date.desc,id.desc&purchase_date=gte.' + selected + '-01&purchase_date=lt.' + next + '-01&limit=100';
        const result = [];
        let page;
        do {
          page = await api(endpoint + query + '&offset=' + result.length);
          if (ticket !== generation || !list.isConnected) return;
          result.push(...page);
        } while (page.length === 100);
        records = result;
        const previous = supplier.value;
        const names = [...new Set(result.map(row => row.supplier).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ar'));
        supplier.replaceChildren(new Option('كل المجهّزين', ''), ...names.map(name => new Option(name,name)));
        if (names.includes(previous)) supplier.value = previous;
        paint();
      } catch (error) {
        if (ticket === generation) list.textContent = 'تعذّر تحميل السجل: ' + error.message;
      }
    }
    month.onchange = document.getElementById('meatRefresh').onclick = refresh;
    supplier.onchange = paint;
    refresh();
  }

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
})();

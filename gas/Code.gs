/**
 * 煎好日｜線上訂單 → Google Sheet（Google Apps Script）
 *
 * 部署步驟請見 gas/README.md：
 * 1. 在試算表的「擴充功能 → Apps Script」貼上本檔。
 * 2. 執行一次 setup()，建立工作表與商品價目表。
 * 3. 部署為「網頁應用程式」（執行身分：我；存取權：所有人），把網址填到 index.html 的 ORDER_API。
 */

const SHEET_ORDERS = '訂單';
const SHEET_ITEMS = '訂單明細';
const SHEET_PRODUCTS = '商品';
const STATUSES = ['新訂單', '製作中', '可取餐', '已完成', '已取消'];
const FULFILLMENTS = ['外帶', '內用', '宅配'];
const SHIPPING_FEE = { '外帶': 0, '內用': 0, '宅配': 0 }; // 需要運費時在這裡調整
const TZ = 'Asia/Taipei';

// 與網站菜單一致的初始價目表（setup 時寫入「商品」工作表，之後以試算表為準）
const DEFAULT_PRODUCTS = [
  ['p1', '經典鮮肉鍋貼', 85], ['p2', '香辣紅油鍋貼', 95], ['p3', '鮮蔬玉米鍋貼', 90],
  ['p4', '手作高麗菜水餃', 90], ['p5', '韭菜鮮肉水餃', 95], ['p6', '暖心酸辣湯', 50],
  ['p7', '清香無糖茶', 35], ['p8', '香拌小黃瓜', 45], ['p9', '滷香豆干', 45],
  ['gift', '招財鍋貼冷凍禮盒 50 入', 520]
];

/* ---------- 初始化（在編輯器中執行一次） ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const orders = sheet_(ss, SHEET_ORDERS, ['建立時間', '訂單編號', '狀態', '取餐方式', '姓名', '電話', '地址', '品項摘要', '小計', '運費', '總額', '備註', '請求編號']);
  sheet_(ss, SHEET_ITEMS, ['訂單編號', '建立時間', '商品編號', '品名', '單價', '數量', '小計']);
  const products = sheet_(ss, SHEET_PRODUCTS, ['商品編號', '品名', '單價', '上架']);
  if (products.getLastRow() < 2) {
    products.getRange(2, 1, DEFAULT_PRODUCTS.length, 4).setValues(DEFAULT_PRODUCTS.map(p => p.concat([true])));
    products.getRange(2, 4, DEFAULT_PRODUCTS.length, 1).insertCheckboxes();
  }
  const statusRange = orders.getRange('C2:C');
  statusRange.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  const colors = { '新訂單': '#fde2c8', '製作中': '#fff2b3', '可取餐': '#d4ecd0', '已完成': '#e6e6e6', '已取消': '#f4c7c3' };
  orders.setConditionalFormatRules(Object.keys(colors).map(s =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(colors[s]).setRanges([statusRange]).build()));
  orders.getRange('F2:F').setNumberFormat('@');
  orders.getRange('I2:K').setNumberFormat('"NT$"#,##0');
  orders.getRange('A2:A').setNumberFormat('yyyy/mm/dd hh:mm');
  return '完成：已建立「訂單」「訂單明細」「商品」工作表';
}

function sheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#37271e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ---------- API ---------- */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'products') return json_({ ok: true, products: products_() });
  return json_({ ok: true, service: '煎好日訂單 API' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.website) return json_({ ok: true, orderId: 'RECEIVED' }); // 防機器人：隱藏欄位被填寫就不寫入
    const order = validate_(body);

    const cache = CacheService.getScriptCache();
    const dupKey = 'req_' + order.requestId;
    const prev = cache.get(dupKey);
    if (prev) return json_(JSON.parse(prev)); // 網路重送：回傳同一筆結果，不重複建單

    const phoneKey = 'phone_' + order.phone.replace(/\D/g, '');
    if (cache.get(phoneKey)) throw new UserError_('送出太頻繁，請稍候 30 秒再試。');

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let result, summary;
    try {
      const again = cache.get(dupKey);
      if (again) return json_(JSON.parse(again));
      const now = new Date();
      const orderId = nextOrderId_(now);
      const ss = SpreadsheetApp.getActive();
      summary = order.lines.map(l => l.name + '×' + l.qty).join('、');
      ss.getSheetByName(SHEET_ORDERS).appendRow([now, orderId, '新訂單', order.fulfillment, safe_(order.customer), "'" + order.phone, // 加 ' 保留電話開頭的 0
       
        safe_(order.address), summary, order.subtotal, order.shipping, order.total, safe_(order.note), order.requestId]);
      const items = ss.getSheetByName(SHEET_ITEMS);
      items.getRange(items.getLastRow() + 1, 1, order.lines.length, 7)
        .setValues(order.lines.map(l => [orderId, now, l.id, l.name, l.price, l.qty, l.price * l.qty]));
      SpreadsheetApp.flush();
      result = { ok: true, orderId: orderId, total: order.total };
      cache.put(dupKey, JSON.stringify(result), 21600);
      cache.put(phoneKey, '1', 30);
    } finally {
      lock.releaseLock();
    }
    notify_(result.orderId, order, summary);
    return json_(result);
  } catch (err) {
    const known = err instanceof UserError_;
    if (!known) console.error(err);
    return json_({ ok: false, error: known ? err.message : '系統忙碌，請稍後再試或直接致電門市。' });
  }
}

/* ---------- 驗證與計價（以「商品」工作表的價格為準，不信任網頁傳來的價格） ---------- */
function UserError_(message) { this.message = message; }

function validate_(b) {
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const o = {
    requestId: str(b.requestId, 64),
    fulfillment: str(b.fulfillment, 10),
    customer: str(b.customer, 40),
    phone: str(b.phone, 20),
    address: str(b.address, 200),
    note: str(b.note, 200)
  };
  if (!/^[\w-]{8,64}$/.test(o.requestId)) throw new UserError_('訂單資料不完整，請重新整理頁面後再試。');
  if (FULFILLMENTS.indexOf(o.fulfillment) < 0) throw new UserError_('請選擇取餐方式。');
  if (!o.customer) throw new UserError_('請填寫聯絡姓名。');
  if (!/^[0-9+()\- ]{8,20}$/.test(o.phone)) throw new UserError_('電話格式不正確。');
  if (o.fulfillment === '宅配' && o.address.length < 6) throw new UserError_('請填寫完整宅配地址。');
  if (o.fulfillment !== '宅配') o.address = '';

  const catalog = {};
  products_().forEach(p => { catalog[p.id] = p; });
  const items = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  const merged = {};
  items.forEach(i => {
    const id = str(i && i.id, 20);
    const qty = Math.floor(Number(i && i.qty));
    if (!catalog[id]) throw new UserError_('有商品已下架或不存在，請重新整理頁面。');
    if (!(qty >= 1 && qty <= 50)) throw new UserError_('每項商品數量需介於 1–50。');
    merged[id] = (merged[id] || 0) + qty;
  });
  o.lines = Object.keys(merged).map(id => ({ id: id, name: catalog[id].name, price: catalog[id].price, qty: merged[id] }));
  if (!o.lines.length) throw new UserError_('購物車是空的。');
  o.subtotal = o.lines.reduce((s, l) => s + l.price * l.qty, 0);
  o.shipping = SHIPPING_FEE[o.fulfillment] || 0;
  o.total = o.subtotal + o.shipping;
  return o;
}

function products_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PRODUCTS);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_PRODUCTS.map(p => ({ id: p[0], name: p[1], price: p[2] }));
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(r => r[0] && r[3] !== false && Number(r[2]) > 0)
    .map(r => ({ id: String(r[0]).trim(), name: String(r[1]), price: Number(r[2]) }));
}

/* ---------- 工具 ---------- */
function nextOrderId_(now) {
  const day = Utilities.formatDate(now, TZ, 'yyyyMMdd');
  const props = PropertiesService.getScriptProperties();
  const key = 'seq_' + day;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return 'JGD-' + day + '-' + ('000' + n).slice(-4);
}

// 避免試算表把顧客輸入的內容當成公式執行
function safe_(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }

// 在「專案設定 → 指令碼屬性」新增 NOTIFY_EMAIL，就會在每筆新訂單寄信通知
function notify_(orderId, o, summary) {
  const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail(to, '【煎好日】新訂單 ' + orderId + '（' + o.fulfillment + '）NT$' + o.total,
      ['訂單編號：' + orderId, '取餐方式：' + o.fulfillment, '姓名：' + o.customer, '電話：' + o.phone,
        o.address ? '地址：' + o.address : '', '品項：' + summary, '總額：NT$' + o.total, o.note ? '備註：' + o.note : '',
        '', '試算表：' + SpreadsheetApp.getActive().getUrl()].filter(Boolean).join('\n'));
  } catch (err) { console.error('通知信寄送失敗', err); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 測試：在編輯器中執行，會寫入一筆測試訂單 ---------- */
function testOrder() {
  const res = doPost({ postData: { contents: JSON.stringify({
    requestId: 'test-' + Date.now(), fulfillment: '外帶', customer: '測試', phone: '0912345678',
    items: [{ id: 'p1', qty: 2 }, { id: 'p6', qty: 1 }], note: '測試訂單，可刪除'
  }) } });
  Logger.log(res.getContent());
}

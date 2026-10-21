// Пульт демо – не часть модуля. Меняет условия визита через адрес (w-device, w-ref, w-ctrl, utm_*):
// модуль принимает w-* только при "demo": true в настройках. На сайты не ставится.
(function () {
  var q = new URLSearchParams(location.search);
  var say = function (t) { dispatchEvent(new CustomEvent('w-log', { detail: { k: 'text', a: [t] } })); };
  var consent = function () { try { return JSON.parse(localStorage.getItem('gm_consent') || 'null'); } catch (e) { return null; } };
  // Заглушка Метрики: настоящий счётчик в демо не грузится, на mc.yandex.ru ничего не уходит.
  var stub = function () { window.ym = function () {}; };
  if (consent() && consent().yandex) stub();
  var go = function (p) {
    var u = new URL(location.href);
    Object.keys(p).forEach(function (k) { p[k] == null ? u.searchParams.delete(k) : u.searchParams.set(k, p[k]); });
    location.href = u.toString();
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.pult [data-p], .pult [data-a]');
    if (!b) return;
    var p = b.dataset.p, v = b.dataset.v, a = b.dataset.a;
    if (p === 'device') go({ 'w-device': v });
    if (p === 'ref') go(v === 'ad'
      ? { 'w-ref': 'ad', utm_source: 'yandex', utm_medium: 'cpc', utm_campaign: 'kotly' }
      : { 'w-ref': 'search', utm_source: null, utm_medium: null, utm_campaign: null });
    if (p === 'ctrl') go({ 'w-ctrl': q.get('w-ctrl') === '1' ? '0' : '1' });
    if (a === 'consent-yes' || a === 'consent-min') {
      var y = a === 'consent-yes';
      localStorage.setItem('gm_consent', JSON.stringify({ v: 1, necessary: true, yandex: y, at: new Date().toISOString() }));
      if (y) stub();
      say(y ? 'Пульт: согласие на cookie дано (Метрика в демо – заглушка, на mc.yandex.ru ничего не уходит)'
        : 'Пульт: выбраны только необходимые cookie – Метрика не включается');
      dispatchEvent(new CustomEvent('gm-consent', { detail: { yandex: y } }));
    }
    if (a === 'exit') {
      say('Пульт: курсор ушёл к вкладкам');
      document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: -1, relatedTarget: null }));
    }
    if (a === 'reset') {
      [localStorage, sessionStorage].forEach(function (s) {
        Object.keys(s).filter(function (k) { return k.indexOf('w_') === 0 || k === 'gm_consent'; }).forEach(function (k) { s.removeItem(k); });
      });
      go({ 'w-ctrl': null });
    }
    if (a === 'thanks') { e.preventDefault(); location.href = b.getAttribute('href') + location.search; }
  });

  // Что сейчас выбрано – подсветка кнопок и строка состояния.
  var dev = q.get('w-device') || (matchMedia('(max-width: 767px), (hover: none)').matches ? 'phone' : 'desktop');
  var ref = q.get('w-ref') || 'прямой заход';
  var ctrl = q.get('w-ctrl') === '1';
  document.querySelectorAll('.pult [data-p]').forEach(function (b) {
    var on = (b.dataset.p === 'device' && b.dataset.v === dev) || (b.dataset.p === 'ref' && b.dataset.v === ref) || (b.dataset.p === 'ctrl' && ctrl);
    b.setAttribute('aria-pressed', String(on));
    if (b.dataset.p === 'ctrl') b.textContent = ctrl ? 'Выключить контрольную группу' : 'Включить контрольную группу';
  });
  var paint = function () {
    var c = consent();
    var st = document.querySelector('[data-state]');
    if (st) st.textContent = 'Сейчас: ' + (dev === 'phone' ? 'телефон' : 'компьютер') + ' · вход: ' +
      (ref === 'search' ? 'с поиска' : ref === 'ad' ? 'с рекламы kotly' : ref) + ' · cookie: ' +
      (c ? (c.yandex ? 'согласие дано' : 'только необходимые') : 'выбор не сделан') + (ctrl ? ' · контрольная группа' : '');
  };
  paint();
  addEventListener('gm-consent', paint);
})();

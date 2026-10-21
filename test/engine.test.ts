// Тесты неотключаемых правил: по тесту на правило. Запуск: npm test (Node 26 исполняет .ts сам).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allow, CONTROL_SHARE, dateText, inControl, LAYER, match, pick, sig, term, validate, view, waitMs,
  type Ctx, type Mem, type Widget,
} from '../src/engine.ts';

const T = Date.parse('2026-10-21T05:00:00Z'); // 12:00 в Новосибирске (UTC+7), среда
const DAY = 864e5;
const ctx = (o: Partial<Ctx> = {}): Ctx => ({
  now: T, visitStart: T - 60e3, path: '/', phone: false, seo: false, utm: {}, returning: false,
  quiet: false, storage: true, cookieChosen: true, control: false, tz: 7, ...o,
});
const mem = (o: Partial<Mem> = {}): Mem => ({ w: {}, sess: {}, ...o });
const w = (o: Partial<Widget> = {}): Widget => ({ id: 'x', type: 'modal', enabled: true, trigger: { on: 'time', s: 20 }, ...o });

test('новый виджет выключен по умолчанию (enabled не true – не показывается)', () => {
  assert.equal(validate(w({ enabled: undefined }))?.why, 'выключен в настройках');
  assert.equal(validate(w({ enabled: false }))?.why, 'выключен в настройках');
  assert.equal(validate(w()), null);
});

test('неизвестный тип (колесо, «кто-то купил») отклоняется движком', () => {
  for (const type of ['wheel', 'koleso', 'social-proof', 'kto-to-kupil', 'push']) {
    assert.match(validate(w({ type }))!.rule, /колесо, «кто-то купил»/);
  }
});

test('таймер – только «до даты» из настроек', () => {
  assert.match(validate(w({ type: 'bar', content: { timer: true } }))!.why, /таймер без даты/);
  assert.equal(validate(w({ type: 'bar', content: { timer: true }, target: { dateTo: '2026-11-30' } })), null);
  // После даты условие не показывается, дата словами – из настроек
  assert.match(match(w({ target: { dateTo: '2026-10-20' } }), ctx())!.why, /закончилось/);
  assert.equal(dateText('2026-11-30'), '30 ноября');
});

test('перекрывающее окно не может появиться сразу при входе (load)', () => {
  assert.match(validate(w({ trigger: { on: 'load' } }))!.rule, /не показывается сразу при входе/);
  assert.equal(validate(w({ type: 'bar', trigger: { on: 'load' } })), null);
});

test('одно перекрывающее окно за сессию', () => {
  assert.equal(allow(w(), ctx(), mem()), null);
  assert.match(allow(w({ id: 'y' }), ctx(), mem({ ov: 'x' }))!.rule, /одно перекрывающее окно за визит/);
  // ярлычок и плашка – не окна, правило их не касается
  assert.equal(allow(w({ id: 'y', type: 'tab' }), ctx(), mem({ ov: 'x' })), null);
});

test('первые 10 с – только click', () => {
  const early = ctx({ visitStart: T - 3e3 });
  assert.match(allow(w(), early, mem())!.rule, /первые 10 секунд/);
  assert.equal(waitMs(early), 7e3);
  assert.equal(allow(w(), ctx({ visitStart: T - 10e3 }), mem()), null);
  // по клику правила самопоявления не применяются – проверяется только настройка
  assert.equal(validate(w({ trigger: { on: 'click' } })), null);
});

test('телефон + поисковая страница: окно по времени/прокрутке становится ярлычком или плашкой', () => {
  assert.equal(view(w(), ctx({ phone: true, seo: true })), 'tab');
  assert.equal(view(w({ trigger: { on: 'scroll', pct: 50 }, mobileAs: 'bar' }), ctx({ phone: true, seo: true })), 'bar');
  assert.equal(view(w(), ctx({ phone: false, seo: true })), 'modal');
  assert.equal(view(w({ trigger: { on: 'click' } }), ctx({ phone: true, seo: true })), 'modal');
});

test('на телефоне окно на уходе не срабатывает', () => {
  const exit = w({ trigger: { on: 'exit' } });
  assert.deepEqual(match(exit, ctx({ phone: true })), { why: 'вы с телефона', rule: 'на телефоне окно на уходе не работает' });
  assert.equal(match(exit, ctx({ phone: false })), null);
});

test('после заявки – тишина группы lead 90 дней', () => {
  const m = mem({ leadAt: T - 10 * DAY });
  assert.match(allow(w(), ctx(), m)!.rule, /90 дней/);
  assert.match(allow(w({ type: 'tab' }), ctx(), m)!.rule, /90 дней/);
  assert.equal(allow(w({ type: 'bar', group: 'promo' }), ctx(), m), null);
  assert.equal(allow(w(), ctx(), mem({ leadAt: T - 91 * DAY })), null);
});

test('контрольная группа 10% без самопоявляющихся', () => {
  assert.match(allow(w({ type: 'bar', trigger: { on: 'load' } }), ctx({ control: true }), mem())!.why, /контрольной группе/);
  assert.equal(inControl(CONTROL_SHARE - 0.01), true);
  assert.equal(inControl(CONTROL_SHARE), false);
  assert.equal(CONTROL_SHARE, 0.1);
});

test('<body data-w-quiet> – ни одного самопоявляющегося', () => {
  for (const type of ['modal', 'tab', 'bar', 'contacts']) {
    assert.match(allow(w({ type, trigger: { on: type === 'modal' ? 'time' : 'load' } }), ctx({ quiet: true }), mem())!.why, /тихая страница/);
  }
});

test('пока не сделан выбор cookie – самопоявляющиеся ждут', () => {
  assert.match(allow(w(), ctx({ cookieChosen: false }), mem())!.rule, /окно cookie/);
});

test('нет хранилища – самопоявляющиеся не показываются', () => {
  assert.match(allow(w({ type: 'tab' }), ctx({ storage: false }), mem())!.rule, /лучше промолчать/);
});

test('слои: cookie > виджет > липкая панель > ярлычок', () => {
  assert.ok(LAYER.cookie > LAYER.overlay && LAYER.overlay > LAYER.sticky && LAYER.sticky > LAYER.tab);
});

test('частота: пауза после закрытия, сброс при смене текста, maxShows без действия', () => {
  const x = w({ type: 'tab', trigger: { on: 'time', s: 10 }, content: { label: 'Подобрать' } });
  assert.match(allow(x, ctx(), mem({ w: { x: { c: T - 2 * DAY, s: sig(x) } } }))!.rule, /пауза 7/);
  assert.equal(allow(x, ctx(), mem({ w: { x: { c: T - 2 * DAY, s: 'старый' } } })), null);
  assert.match(allow(x, ctx(), mem({ w: { x: { n: 3 } } }))!.rule, /после 3 показов/);
  assert.equal(allow(x, ctx(), mem({ w: { x: { n: 3, a: T } } })), null);
});

test('кто победил – больший priority', () => {
  assert.equal(pick([w({ id: 'a', priority: 1 }), w({ id: 'b', priority: 5 }), w({ id: 'c', priority: 5 })]).id, 'b');
});

test('условия показа: страницы, метка кампании, устройство, часы', () => {
  assert.match(match(w({ target: { include: ['/katalog/*'] } }), ctx({ path: '/' }))!.why, /не в списке/);
  assert.equal(match(w({ target: { include: ['/katalog/*'] } }), ctx({ path: '/katalog/kotly' })), null);
  assert.match(match(w({ target: { utm: 'kotly' } }), ctx())!.why, /не с рекламы/);
  assert.equal(match(w({ target: { utm: 'kotly' } }), ctx({ utm: { utm_campaign: 'kotly' } })), null);
  assert.match(match(w({ target: { device: 'desktop' } }), ctx({ phone: true }))!.why, /с телефона/);
  assert.match(match(w({ target: { hours: '18-21' } }), ctx())!.why, /нерабочее/);
});

test('обратный звонок: честный срок по часам работы', () => {
  const cb = w({ type: 'callback', content: { hours: '9-20', soon: 'за 15 минут', later: 'завтра с 9:00' } });
  assert.equal(term(cb, T, 7), 'за 15 минут');
  assert.equal(term(cb, Date.parse('2026-10-21T15:00:00Z'), 7), 'завтра с 9:00'); // 22:00 местного
});

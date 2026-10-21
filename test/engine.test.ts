// Тесты неотключаемых правил: по тесту на правило. Запуск: npm test (Node 26 исполняет .ts сам).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reason, RULES } from '../src/zhurnal.ts';
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
  assert.equal(validate(w({ enabled: undefined }))?.code, 'off');
  assert.equal(validate(w({ enabled: false }))?.code, 'off');
  assert.equal(validate(w()), null);
});

test('неизвестный тип (колесо, «кто-то купил») отклоняется движком', () => {
  for (const type of ['wheel', 'koleso', 'social-proof', 'kto-to-kupil', 'push']) {
    assert.equal(validate(w({ type }))?.code, 'type');
  }
  assert.match(reason(validate(w({ type: 'wheel' }))!), /тип «wheel» модулю неизвестен.*колесо, «кто-то купил»/);
  {
  }
});

test('таймер – только «до даты» из настроек', () => {
  assert.equal(validate(w({ type: 'bar', content: { timer: true } }))?.code, 'timer');
  assert.equal(validate(w({ type: 'bar', content: { timer: true }, target: { dateTo: '2026-11-30' } })), null);
  // После даты условие не показывается, дата словами – из настроек
  assert.deepEqual(match(w({ target: { dateTo: '2026-10-20' } }), ctx()), { code: 'after', p: ['2026-10-20'] });
  assert.equal(dateText('2026-11-30'), '30 ноября');
});

test('перекрывающее окно не может появиться сразу при входе (load)', () => {
  assert.equal(validate(w({ trigger: { on: 'load' } }))?.code, 'load');
  assert.equal(validate(w({ type: 'bar', trigger: { on: 'load' } })), null);
});

test('одно перекрывающее окно за сессию', () => {
  assert.equal(allow(w(), ctx(), mem()), null);
  assert.equal(allow(w({ id: 'y' }), ctx(), mem({ ov: 'x' }))?.code, 'ov');
  assert.equal(allow(w(), ctx(), mem({ ov: 'x' }))?.code, 'ovself');
  // ярлычок и плашка – не окна, правило их не касается
  assert.equal(allow(w({ id: 'y', type: 'tab' }), ctx(), mem({ ov: 'x' })), null);
});

test('первые 10 с – только click', () => {
  const early = ctx({ visitStart: T - 3e3 });
  assert.equal(allow(w(), early, mem())?.code, 'early');
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
  assert.equal(reason(match(exit, ctx({ phone: true }))!), 'вы с телефона (правило: на телефоне окно на уходе не работает)');
  assert.equal(match(exit, ctx({ phone: false })), null);
});

test('после заявки – тишина группы lead 90 дней', () => {
  const m = mem({ leadAt: T - 10 * DAY });
  assert.equal(allow(w(), ctx(), m)?.code, 'lead');
  assert.equal(allow(w({ type: 'tab' }), ctx(), m)?.code, 'lead');
  assert.equal(allow(w({ type: 'bar', group: 'promo' }), ctx(), m), null);
  assert.equal(allow(w(), ctx(), mem({ leadAt: T - 91 * DAY })), null);
});

test('контрольная группа 10% без самопоявляющихся', () => {
  assert.equal(allow(w({ type: 'bar', trigger: { on: 'load' } }), ctx({ control: true }), mem())?.code, 'ctrl');
  assert.equal(inControl(CONTROL_SHARE - 0.01), true);
  assert.equal(inControl(CONTROL_SHARE), false);
  assert.equal(CONTROL_SHARE, 0.1);
});

test('<body data-w-quiet> – ни одного самопоявляющегося', () => {
  for (const type of ['modal', 'tab', 'bar', 'contacts']) {
    assert.equal(allow(w({ type, trigger: { on: type === 'modal' ? 'time' : 'load' } }), ctx({ quiet: true }), mem())?.code, 'quiet');
  }
});

test('пока не сделан выбор cookie – самопоявляющиеся ждут', () => {
  assert.equal(allow(w(), ctx({ cookieChosen: false }), mem())?.code, 'cookie');
});

test('нет хранилища – самопоявляющиеся не показываются', () => {
  assert.equal(allow(w({ type: 'tab' }), ctx({ storage: false }), mem())?.code, 'nostore');
});

test('слои: cookie > виджет > липкая панель > ярлычок', () => {
  assert.ok(LAYER.cookie > LAYER.overlay && LAYER.overlay > LAYER.sticky && LAYER.sticky > LAYER.tab);
});

test('частота: пауза после закрытия, сброс при смене текста, maxShows без действия', () => {
  const x = w({ type: 'tab', trigger: { on: 'time', s: 10 }, content: { label: 'Подобрать' } });
  assert.deepEqual(allow(x, ctx(), mem({ w: { x: { c: T - 2 * DAY, s: sig(x) } } })), { code: 'paused', p: [7] });
  assert.equal(allow(x, ctx(), mem({ w: { x: { c: T - 2 * DAY, s: 'старый' } } })), null);
  assert.deepEqual(allow(x, ctx(), mem({ w: { x: { n: 3 } } })), { code: 'max', p: [3, 3] });
  assert.equal(allow(x, ctx(), mem({ w: { x: { n: 3, a: T } } })), null);
});

test('кто победил – больший priority', () => {
  assert.equal(pick([w({ id: 'a', priority: 1 }), w({ id: 'b', priority: 5 }), w({ id: 'c', priority: 5 })]).id, 'b');
});

test('условия показа: страницы, метка кампании, устройство, часы', () => {
  assert.equal(match(w({ target: { include: ['/katalog/*'] } }), ctx({ path: '/' }))?.code, 'page');
  assert.equal(match(w({ target: { include: ['/katalog/*'] } }), ctx({ path: '/katalog/kotly' })), null);
  assert.equal(match(w({ target: { utm: 'kotly' } }), ctx())?.code, 'utm');
  assert.equal(match(w({ target: { utm: 'kotly' } }), ctx({ utm: { utm_campaign: 'kotly' } })), null);
  assert.equal(match(w({ target: { device: 'desktop' } }), ctx({ phone: true }))?.code, 'onlydesk');
  assert.equal(match(w({ target: { hours: '18-21' } }), ctx())?.code, 'hours');
});

test('обратный звонок: честный срок по часам работы', () => {
  const cb = w({ type: 'callback', content: { hours: '9-20', soon: 'за 15 минут', later: 'завтра с 9:00' } });
  assert.equal(term(cb, T, 7), 'за 15 минут');
  assert.equal(term(cb, Date.parse('2026-10-21T15:00:00Z'), 7), 'завтра с 9:00'); // 22:00 местного
});

test('у каждой причины отказа есть строка для журнала простым русским', () => {
  const src = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');
  // race и busy – решения исполнителя (два окна в один такт, окно уже открыто)
  const codes = [...[...src.matchAll(/no\('(\w+)'/g)].map((m) => m[1]), 'race', 'busy'];
  assert.ok(codes.length >= 28);
  for (const c of codes) assert.ok(RULES[c], `нет текста для кода ${c}`);
});

test('сразу при входе (load) – только плашка и «Позвонить / Написать»; ярлычок и окно ждут 10 с', () => {
  const early = ctx({ visitStart: T - 2e3 });
  for (const type of ['bar', 'contacts']) assert.equal(allow(w({ id: type, type, trigger: { on: 'load' } }), early, mem()), null, type);
  for (const type of ['tab', 'modal', 'sheet']) assert.equal(allow(w({ id: type, type, trigger: { on: 'load' } }), early, mem())?.code, 'early', type);
});

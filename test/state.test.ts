// Тесты окружения визита (src/state.ts) на заглушках браузера: память, согласие cookie, Метрика.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
const g = globalThis as any;
function browser(search = '') {
  const def = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  def('window', g);
  def('localStorage', new Mem());
  def('sessionStorage', new Mem());
  def('location', { search, pathname: '/', href: 'https://x.test/' + search });
  def('document', { referrer: '', querySelector: () => null, body: { hasAttribute: () => false } });
  def('matchMedia', () => ({ matches: false }));
}

const S = await import('../src/state.ts');

test('consent:false – окна cookie нет: виджеты не ждут выбора', () => {
  browser();
  assert.equal(S.init({ widgets: [], consent: false }).cookieChosen, true);
  // обычный сайт: пока нет выбора – ждём; выбор сделан – не ждём
  browser();
  assert.equal(S.init({ widgets: [] }).cookieChosen, false);
  g.localStorage.setItem('gm_consent', JSON.stringify({ v: 1, yandex: false }));
  assert.equal(S.init({ widgets: [] }).cookieChosen, true);
  assert.equal(S.noBanner({ widgets: [], consent: false }), true);
  assert.equal(S.noBanner({ widgets: [], consent: { key: 'gm_consent' } }), false);
});

test('Метрика без счётчика (consent:false даёт 0) – события не копятся', () => {
  browser();
  S.metrika(0, false);
  assert.equal(S.ym('reachGoal', 'lead'), -1);
});

test('демо: память – до закрытия вкладки (в localStorage виджеты ничего не пишут)', () => {
  browser();
  S.init({ widgets: [], demo: true, consent: false });
  S.shown({ id: 'x', type: 'modal' }, 'modal');
  assert.equal(g.localStorage.length, 0);
  assert.ok(g.sessionStorage.getItem('w_mem'));
  // на сайте – как раньше: показы помнятся между визитами
  browser();
  S.init({ widgets: [], consent: false });
  S.shown({ id: 'x', type: 'modal' }, 'modal');
  assert.ok(g.localStorage.getItem('w_mem'));
});

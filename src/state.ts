// Память и окружение визита: localStorage / sessionStorage в try/catch, согласие cookie, очередь Метрики, журнал.
// Хранилище недоступно – storage:false, и движок не даёт самопоявляющимся виджетам показаться.
import { CONTROL_DAYS, inControl, isOverlay, name, sig, type Ctx, type Mem, type Widget } from './engine.ts';

export interface Config {
  widgets: Widget[];
  /** Демо: принимает w-device, w-ref, w-ctrl из адреса, пишет журнал решений (событие w-log), память – до закрытия вкладки. */
  demo?: boolean;
  /** Куда слать заявку; «demo:» – заглушка, отвечает «принято» через 0,5 с. */
  endpoint?: string;
  tz?: number;
  agreement?: string;
  marketingDoc?: string;
  metrika?: number;
  /** Где сайт хранит выбор cookie. false – на странице нет окна cookie (прототип): виджеты не ждут выбора, Метрику не трогают. */
  consent?: false | { key?: string; event?: string };
}
interface Land { page: string; utm: Record<string, string>; ref: string; search: boolean }

const P = 'w_';
const DAY = 864e5;
let ls: Storage | null = null;
let ss: Storage | null = null;
let demo = false;

function probe(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    const s = window[kind];
    s.setItem(P + 't', '1');
    s.removeItem(P + 't');
    return s;
  } catch { return null; }
}
function get<T>(s: Storage | null, k: string, d: T): T {
  try {
    const v = s && s.getItem(P + k);
    return v ? JSON.parse(v) : d;
  } catch { return d; }
}
function put(s: Storage | null, k: string, v: unknown) {
  try { s && s.setItem(P + k, JSON.stringify(v)); } catch { /* память переполнена – живём без неё */ }
}

export const mem: Mem = { w: {}, sess: {} };
export let pages = 0;
let land: Land = { page: '', utm: {}, ref: '', search: false };

/** Журнал решений – только в демо: код записи уходит событием w-log, по-русски его пишет src/zhurnal.ts. */
export function log(k: string, ...a: unknown[]) {
  if (demo) dispatchEvent(new CustomEvent('w-log', { detail: { k, a } }));
}

/** Выбор по cookie сайта (gaz-mag: localStorage gm_consent = { v:1, yandex }). null – выбора ещё не было. */
export function readConsent(cfg: Config): { yandex: boolean } | null {
  try {
    const c = JSON.parse(localStorage.getItem((cfg.consent || {}).key || 'gm_consent') || 'null');
    return c ? { yandex: !!c.yandex } : null;
  } catch { return null; }
}

/** Окна cookie на странице нет (consent:false) – ждать нечего, а Метрику модуль не включает. */
export const noBanner = (cfg: Config) => cfg.consent === false;

/** Собрать всё, что движок знает о визите. Вызывается один раз при запуске острова. */
export function init(cfg: Config): Ctx {
  demo = !!cfg.demo;
  ss = probe('sessionStorage');
  // Демо и прототипы: память – до закрытия вкладки, чтобы показ можно было повторить в новой вкладке.
  ls = demo ? ss : probe('localStorage');
  const now = Date.now();
  const q = new URLSearchParams(location.search);
  const dq = (k: string) => (demo ? q.get('w-' + k) : null);

  let t0 = get(ss, 't0', 0);
  const first = !t0;
  if (first) t0 = now;
  const returning = first ? !!get(ls, 'seen', 0) : get(ss, 'ret', false);
  pages = get(ss, 'pages', 0) + 1;

  land = get(ss, 'land', land);
  const utm: Record<string, string> = {};
  q.forEach((v, k) => { if (k.startsWith('utm_')) utm[k] = v; });
  if (first || Object.keys(utm).length || dq('ref')) {
    const ref = document.referrer;
    const search = dq('ref') ? dq('ref') === 'search' : /(^|\.)(yandex|google|bing|mail|duckduckgo)\./.test(host(ref));
    land = { page: location.pathname, utm: Object.keys(utm).length ? utm : first ? {} : land.utm, ref, search };
  }

  let ctrl = get(ls, 'ctrl', { v: false, until: 0 });
  const force = dq('ctrl');
  // В демо контрольная группа включается только пультом, чтобы показ не зависел от случая.
  if (force || demo) ctrl = { v: force === '1', until: now + CONTROL_DAYS * DAY };
  else if (ctrl.until < now) ctrl = { v: inControl(Math.random()), until: now + CONTROL_DAYS * DAY };

  if (ls && ss) {
    put(ss, 't0', t0);
    put(ss, 'ret', returning);
    put(ss, 'pages', pages);
    put(ss, 'land', land);
    put(ls, 'seen', now);
    put(ls, 'ctrl', ctrl);
  }
  mem.leadAt = get(ls, 'lead', 0);
  mem.w = get(ls, 'mem', {});
  const ov = get<string[] | string>(ss, 'ov', []);
  mem.ov = Array.isArray(ov) ? ov : ov ? [ov] : [];
  mem.ovg = get(ss, 'ovg', '');
  mem.sess = get(ss, 'sess', {});

  const device = dq('device');
  return {
    now,
    visitStart: t0,
    path: location.pathname,
    phone: device ? device === 'phone' : matchMedia('(max-width: 767px), (hover: none)').matches,
    seo: land.search || !document.querySelector('meta[name="robots"][content*="noindex"]'),
    utm: land.utm,
    returning,
    quiet: document.body.hasAttribute('data-w-quiet'),
    storage: !!(ls && ss),
    cookieChosen: noBanner(cfg) || !!readConsent(cfg),
    control: !!(ls && ctrl.v),
    tz: cfg.tz ?? 3,
  };
}

function host(u: string) {
  try { return new URL(u).hostname; } catch { return ''; }
}
const saveW = () => put(ls, 'mem', mem.w);
const one = (w: Widget) => (mem.w[w.id] ||= {});

/** Показан сам: счётчик визита, счётчик показов (один раз за визит), окна визита и группа первого. */
export function shown(w: Widget, as: string) {
  if (!mem.sess[w.id]) one(w).n = (one(w).n || 0) + 1;
  mem.sess[w.id] = (mem.sess[w.id] || 0) + 1;
  if (isOverlay(as)) {
    const ov = (mem.ov ||= []);
    if (!ov.length) put(ss, 'ovg', (mem.ovg = w.group || 'lead'));
    ov.push(w.id);
    put(ss, 'ov', ov);
  }
  put(ss, 'sess', mem.sess);
  saveW();
}
/** Человек что-то сделал с виджетом (открыл, нажал) – maxShows больше не считается. */
export function acted(w: Widget) {
  one(w).a = Date.now();
  saveW();
}
/** Закрыл – пауза по настройке, пока не поменяется текст. */
export function closed(w: Widget) {
  Object.assign(one(w), { c: Date.now(), s: sig(w) });
  saveW();
}
export function leadSent() {
  put(ls, 'lead', (mem.leadAt = Date.now()));
}

// Метрика: события копятся, пока нет согласия на cookie и самой Метрики (её грузит сайт после согласия).
const queue: unknown[][] = [];
let metrikaId = 0;
let metrikaOk = false;
export function metrika(id: number | undefined, ok: boolean) {
  metrikaId = id || 0;
  metrikaOk = ok;
  if (!ok) queue.length = 0; // отказ от cookie – события не копим
  return flush();
}
/** Вернёт, сколько событий ждёт в очереди; -1 – Метрика на сайте не настроена. */
export function ym(...a: unknown[]): number {
  if (!metrikaId) return -1;
  queue.push(a);
  return flush();
}
function flush(): number {
  const f = (window as any).ym;
  if (metrikaOk && metrikaId && typeof f === 'function') while (queue.length) f(metrikaId, ...queue.shift()!);
  return queue.length;
}

/** Отправка заявки. В заявку – виджет (source: w:<id>), страница входа и utm, как у формы страницы. */
export async function send(cfg: Config, w: Widget, fields: Record<string, string>, marketing: boolean): Promise<boolean> {
  const body = {
    form: 'Виджет: ' + name(w), consent: true, marketing, source: 'w:' + w.id,
    page: location.pathname, landing: land.page, utm: land.utm, referrer: land.ref,
    // Page в полях – как у LeadForm gaz-mag: приёмник server/lead.mjs берёт страницу и категорию оттуда.
    fields: { ...fields, Page: location.pathname },
  };
  if (cfg.endpoint === 'demo:') {
    log('send', body);
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }
  try {
    const r = await fetch(cfg.endpoint || '/api/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return r.ok;
  } catch { return false; }
}

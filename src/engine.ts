// Движок виджетов: чистые функции без браузера – подходит ли виджет, можно ли показать, кто победил.
// Неотключаемые правила живут здесь, у каждого – свой тест (test/engine.test.ts). Менять только с «да» владельца.

export type On = 'click' | 'load' | 'time' | 'scroll' | 'block' | 'exit' | 'pages';

/** Типы, которые модуль умеет. Колеса, «кто-то купил», «сейчас смотрят N» нет и не будет – это решение. */
export const TYPES = ['tab', 'bar', 'sheet', 'modal', 'quiz', 'callback', 'contacts'];
/** Перекрывающие страницу – для них «не больше двух окон за визит» и защита SEO на телефоне. */
export const OVERLAYS = ['sheet', 'modal', 'quiz', 'callback'];
const ONS: On[] = ['click', 'load', 'time', 'scroll', 'block', 'exit', 'pages'];

export interface Widget {
  id: string;
  enabled?: boolean;
  type: string;
  title?: string;
  group?: string;
  priority?: number;
  content?: Record<string, any>;
  trigger?: { on?: On; s?: number; pct?: number; sel?: string; n?: number };
  target?: {
    include?: string[]; exclude?: string[]; utm?: string; device?: 'phone' | 'desktop'; visitor?: 'new' | 'back';
    dateFrom?: string; dateTo?: string; hours?: string; days?: number[];
  };
  freq?: { perSession?: number; closeDays?: number; maxShows?: number };
  form?: { fields?: string[]; marketing?: boolean; button?: string };
  goal?: string;
  mobileAs?: 'tab' | 'bar';
}

/** Что известно о визите. Собирает state.ts из браузера, в тестах – руками. */
export interface Ctx {
  now: number;
  visitStart: number;
  path: string;
  phone: boolean;
  /** Индексируемая страница или вход с поиска – на телефоне ничего не перекрывает страницу. */
  seo: boolean;
  utm: Record<string, string>;
  returning: boolean;
  /** <body data-w-quiet>: «Спасибо», корзина, оформление, юр-страницы, 404, ЛК. */
  quiet: boolean;
  storage: boolean;
  cookieChosen: boolean;
  control: boolean;
  /** Часовой пояс магазина: смещение от UTC в часах (Новосибирск – 7). */
  tz: number;
}

/** Память: по виджету (n – показов, a – было действие, c – когда закрыли, s – подпись текста) и по визиту. */
export interface Mem {
  leadAt?: number;
  /** Окна, которые сами показались в этом визите, по порядку; ovg – группа первого. */
  ov?: string[];
  ovg?: string;
  w: Record<string, { n?: number; a?: number; c?: number; s?: string }>;
  sess: Record<string, number>;
}

/** null – можно; иначе код причины и подробности. Тексты простым русским – в src/zhurnal.ts (только демо, в бой не идут). */
export type No = { code: string; p: unknown[] } | null;
const no = (code: string, ...p: unknown[]): No => ({ code, p });

const DAY = 864e5;
export const QUIET_SEC = 10;
/** Окон за визит: первое – любое, второе – только на уходе. */
export const MAX_OV = 2;
export const LEAD_DAYS = 90;
export const CONTROL_SHARE = 0.1;
export const CONTROL_DAYS = 30;
/** Слои: окно cookie сайта > открытый виджет > липкая панель > ярлычок и плашка (cookie у gaz-mag – z-index 130). */
export const LAYER = { cookie: 130, overlay: 110, sticky: 90, tab: 80, bar: 80 };

export const name = (w: Widget) => w.title || w.id;
export const on = (w: Widget): On => w.trigger?.on || 'click';
export const isAuto = (w: Widget) => on(w) !== 'click';
export const isOverlay = (type: string) => OVERLAYS.includes(type);
/** Подпись содержимого: поменяли текст – пауза после закрытия снимается. */
export const sig = (w: Widget) => {
  let h = 0;
  for (const ch of JSON.stringify(w.content || {})) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h.toString(36);
};

/** Проверка настройки: годится ли виджет вообще. */
/** Типы, которым разрешено появиться сразу при входе (trigger load): не перекрывают страницу. */
export const LOAD_OK = ['bar', 'contacts'];

export function validate(w: Widget): No {
  if (!w || !w.id) return no('noid');
  if (!TYPES.includes(w.type)) return no('type', w.type);
  if (!ONS.includes(on(w))) return no('trig', on(w));
  if (on(w) === 'load' && isOverlay(w.type)) return no('load');
  if (w.content?.timer && !w.target?.dateTo) return no('timer');
  if (w.enabled !== true) return no('off');
  return null;
}

/** Местное время магазина. */
const local = (now: number, tz: number) => new Date(now + tz * 36e5);
export const ymd = (now: number, tz: number) => local(now, tz).toISOString().slice(0, 10);

/** Рабочие часы «9-20» и дни недели (1 – понедельник … 7 – воскресенье) по времени магазина. */
export function inHours(now: number, tz: number, hours?: string, days?: number[]): boolean {
  const d = local(now, tz);
  if (days && !days.includes(d.getUTCDay() || 7)) return false;
  if (!hours) return true;
  const [a, b] = hours.split('-').map(Number);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= a && h < b;
}

const pathIn = (path: string, list: string[]) =>
  list.some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p || path === p + '/'));

/** Подходит ли виджет этому визиту: устройство, страница, метка, новый/вернувшийся, даты, часы. */
export function match(w: Widget, c: Ctx): No {
  const t = w.target || {};
  if (on(w) === 'exit' && c.phone) return no('exit');
  if (t.device === 'phone' && !c.phone) return no('onlyphone');
  if (t.device === 'desktop' && c.phone) return no('onlydesk');
  if (t.include && !pathIn(c.path, t.include)) return no('page', c.path);
  if (t.exclude && pathIn(c.path, t.exclude)) return no('excl', c.path);
  if (t.utm && c.utm.utm_campaign !== t.utm) return no('utm', t.utm);
  if (t.visitor === 'new' && c.returning) return no('new');
  if (t.visitor === 'back' && !c.returning) return no('back');
  const day = ymd(c.now, c.tz);
  if (t.dateFrom && day < t.dateFrom) return no('before', t.dateFrom);
  if (t.dateTo && day > t.dateTo) return no('after', t.dateTo);
  if ((t.hours || t.days) && !inHours(c.now, c.tz, t.hours, t.days)) return no('hours');
  return null;
}

/** Сколько ещё ждать до конца первых 10 секунд визита. */
export const waitMs = (c: Ctx) => Math.max(0, c.visitStart + QUIET_SEC * 1e3 - c.now);

/** Можно ли показать самопоявляющийся виджет прямо сейчас. По клику человека показывается всегда (после validate). */
export function allow(w: Widget, c: Ctx, m: Mem): No {
  if (c.quiet) return no('quiet');
  if (!c.storage) return no('nostore');
  if (!c.cookieChosen) return no('cookie');
  if (c.control) return no('ctrl');
  if ((w.group || 'lead') === 'lead' && m.leadAt && c.now - m.leadAt < LEAD_DAYS * DAY) return no('lead');
  const s = m.w[w.id] || {};
  const f = w.freq || {};
  const ov = isOverlay(w.type);
  const pause = f.closeDays ?? (w.type === 'bar' ? 365 : 7);
  if (s.c && s.s === sig(w) && c.now - s.c < pause * DAY) return no('paused', pause);
  const max = f.maxShows ?? (ov || w.type === 'tab' ? 3 : 0);
  if (max && !s.a && (s.n || 0) >= max) return no('max', s.n, max);
  const ovs = m.ov || [];
  if (ov && ovs.includes(w.id)) return no('ovself');
  if (ov && ovs.length >= MAX_OV) return no('ov', MAX_OV);
  // Второе окно визита – только на уходе; и не той же группы, если после первого уже оставили заявку.
  if (ov && ovs.length && on(w) !== 'exit') return no('ov2');
  if (ov && ovs.length && m.leadAt && m.leadAt >= c.visitStart && (w.group || 'lead') === m.ovg) return no('ov2lead', m.ovg);
  const per = f.perSession ?? (ov ? 1 : 0);
  if (per && (m.sess[w.id] || 0) >= per) return no('per', per);
  // Сразу при входе можно только постоянное и неперекрывающее: плашка-условие и «Позвонить / Написать». Остальное – после 10 с.
  if (!(on(w) === 'load' && LOAD_OK.includes(w.type)) && waitMs(c) > 0) return no('early', QUIET_SEC);
  return null;
}

/** Каким видом показать. Телефон + поисковая страница: окно по времени или прокрутке становится ярлычком или плашкой. */
export function view(w: Widget, c: Ctx): string {
  if (c.phone && c.seo && isOverlay(w.type) && isAuto(w)) return w.mobileAs || 'tab';
  return w.type;
}

/** Кто победил, если сработали несколько сразу: больший priority, при равенстве – первый в списке. */
export const pick = (ws: Widget[]) => ws.reduce((a, b) => ((b.priority || 0) > (a.priority || 0) ? b : a));

/** Попадает ли посетитель в контрольную группу (r – случайное 0…1). */
export const inControl = (r: number) => r < CONTROL_SHARE;

/** Честный срок обратного звонка по часам работы из настроек виджета. */
export function term(w: Widget, now: number, tz: number): string {
  const k = w.content || {};
  return inHours(now, tz, k.hours || '9-18', k.days)
    ? k.soon || 'Перезвоним в течение рабочего дня'
    : k.later || 'Перезвоним в рабочее время';
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «2026-11-30» → «30 ноября» – срок акции словами, из настроек, а не от первого визита. */
export const dateText = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;

/** Кнопка нижней панели телефона: ссылка, открыть виджет по id или прокрутить к якорю. kind main – главная кнопка страницы. */
export interface Btn { text?: string; href?: string; open?: string; scroll?: string; kind?: 'main' | 'alt' }
/** Кнопки нижней панели: из content.buttons, без настроек – «Позвонить / Написать». Без текста или цели кнопка не рисуется. */
export function buttons(k: Record<string, any>): Btn[] {
  const b: Btn[] = k.buttons || [
    { text: 'Позвонить', href: k.phone && 'tel:' + k.phone, kind: 'main' },
    { text: 'Написать', href: k.write || k.tg, kind: 'alt' },
  ];
  return b.filter((x) => x && x.text && (x.href || x.open || x.scroll));
}
/** Боковая панель компьютера (layout:"side"): [канал, ссылка, подпись] – только то, что есть в настройках. */
export function side(k: Record<string, any>): [string, string, string][] {
  const all: [string, string | false, string][] = [
    ['phone', !!k.phone && 'tel:' + k.phone, k.phoneText || k.phone],
    ['whatsapp', k.wa, 'WhatsApp'],
    ['telegram', k.tg, 'Telegram'],
    ['max', k.max, 'MAX'],
    ['mail', !!k.email && 'mailto:' + k.email, k.email],
  ];
  return all.filter((x): x is [string, string, string] => !!x[1]);
}

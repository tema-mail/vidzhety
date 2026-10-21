// Движок виджетов: чистые функции без браузера – подходит ли виджет, можно ли показать, кто победил.
// Неотключаемые правила живут здесь, у каждого – свой тест (test/engine.test.ts). Менять только с «да» владельца.

export type On = 'click' | 'load' | 'time' | 'scroll' | 'block' | 'exit' | 'pages';

/** Типы, которые модуль умеет. Колеса, «кто-то купил», «сейчас смотрят N» нет и не будет – это решение. */
export const TYPES = ['tab', 'bar', 'sheet', 'modal', 'quiz', 'callback', 'survey', 'inline', 'contacts'];
/** Перекрывающие страницу – для них «одно окно за визит» и защита SEO на телефоне. */
export const OVERLAYS = ['sheet', 'modal', 'quiz', 'callback', 'survey'];
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
  ov?: string;
  w: Record<string, { n?: number; a?: number; c?: number; s?: string }>;
  sess: Record<string, number>;
}

/** null – можно; иначе причина простыми словами и правило, которое сработало. */
export type No = { why: string; rule: string } | null;
const no = (why: string, rule: string): No => ({ why, rule });

const DAY = 864e5;
export const QUIET_SEC = 10;
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
export function validate(w: Widget): No {
  if (!w || !w.id) return no('у виджета нет id', 'каждому виджету нужно имя');
  if (!TYPES.includes(w.type)) {
    return no(`тип «${w.type}» модулю неизвестен`, 'колесо, «кто-то купил» и другие типы вне списка модуль не показывает');
  }
  if (!ONS.includes(on(w))) return no(`триггер «${on(w)}» неизвестен`, 'триггеры: click, load, time, scroll, block, exit, pages');
  if (on(w) === 'load' && isOverlay(w.type)) {
    return no('окно при входе на страницу', 'перекрывающее окно не показывается сразу при входе');
  }
  if (w.content?.timer && !w.target?.dateTo) {
    return no('таймер без даты окончания', 'таймер – только «до даты» из настроек, вечных таймеров нет');
  }
  if (w.enabled !== true) return no('выключен в настройках', 'новый виджет выключен, пока его явно не включат');
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
  if (on(w) === 'exit' && c.phone) return no('вы с телефона', 'на телефоне окно на уходе не работает');
  if (t.device === 'phone' && c.phone === false) return no('вы с компьютера', 'виджет настроен только для телефона');
  if (t.device === 'desktop' && c.phone) return no('вы с телефона', 'виджет настроен только для компьютера');
  if (t.include && !pathIn(c.path, t.include)) return no(`страница ${c.path} не в списке`, 'показ только на выбранных страницах');
  if (t.exclude && pathIn(c.path, t.exclude)) return no(`страница ${c.path} исключена`, 'на исключённых страницах не показывается');
  if (t.utm && c.utm.utm_campaign !== t.utm) {
    return no(`вы пришли не с рекламы «${t.utm}»`, 'виджет только для этой рекламной кампании');
  }
  if (t.visitor === 'new' && c.returning) return no('вы уже были на сайте', 'виджет только для новых посетителей');
  if (t.visitor === 'back' && !c.returning) return no('вы на сайте впервые', 'виджет только для вернувшихся');
  const day = ymd(c.now, c.tz);
  if (t.dateFrom && day < t.dateFrom) return no(`условие начнётся ${t.dateFrom}`, 'до даты начала не показывается');
  if (t.dateTo && day > t.dateTo) return no(`условие закончилось ${t.dateTo}`, 'после даты окончания не показывается');
  if ((t.hours || t.days) && !inHours(c.now, c.tz, t.hours, t.days)) {
    return no('сейчас нерабочее время', 'виджет показывается только в часы работы');
  }
  return null;
}

/** Сколько ещё ждать до конца первых 10 секунд визита. */
export const waitMs = (c: Ctx) => Math.max(0, c.visitStart + QUIET_SEC * 1e3 - c.now);

/** Можно ли показать самопоявляющийся виджет прямо сейчас. По клику человека показывается всегда (после validate). */
export function allow(w: Widget, c: Ctx, m: Mem): No {
  if (c.quiet) return no('это тихая страница (data-w-quiet)', 'на «Спасибо», корзине, оформлении и юр-страницах виджеты сами не появляются');
  if (!c.storage) return no('браузер не даёт память (приватный режим)', 'без памяти не соблюсти частоту – лучше промолчать');
  if (!c.cookieChosen) return no('ещё не сделан выбор по cookie', 'пока открыто окно cookie, виджеты ждут');
  if (c.control) {
    return no('вы в контрольной группе', '10% посетителей 30 дней не видят самопоявляющихся виджетов – так честно меряем эффект');
  }
  if ((w.group || 'lead') === 'lead' && m.leadAt && c.now - m.leadAt < LEAD_DAYS * DAY) {
    return no('вы уже оставили заявку', 'после заявки виджеты заявок молчат 90 дней');
  }
  const s = m.w[w.id] || {};
  const f = w.freq || {};
  const ov = isOverlay(w.type);
  const pause = f.closeDays ?? (w.type === 'bar' ? 365 : 7);
  if (s.c && s.s === sig(w) && c.now - s.c < pause * DAY) {
    return no('вы его уже закрыли', `после закрытия – пауза ${pause} дн. (или до смены текста)`);
  }
  const max = f.maxShows ?? (ov || w.type === 'tab' ? 3 : 0);
  if (max && !s.a && (s.n || 0) >= max) {
    return no(`показан ${s.n} раз без отклика`, `после ${max} показов без действия больше не показывается`);
  }
  if (ov && m.ov) {
    return no(m.ov === w.id ? 'уже показано в этом визите' : 'в этом визите уже было окно', 'одно перекрывающее окно за визит');
  }
  const per = f.perSession ?? (ov ? 1 : 0);
  if (per && (m.sess[w.id] || 0) >= per) return no('уже показан в этом визите', `не больше ${per} раз за визит`);
  if (on(w) !== 'load' && waitMs(c) > 0) {
    return no(`с начала визита прошло меньше ${QUIET_SEC} с`, 'первые 10 секунд – только по клику');
  }
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

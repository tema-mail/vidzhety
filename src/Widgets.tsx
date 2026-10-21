// Исполнитель виджетов: один остров на сайт (<Widgets client:idle src="/widgets.json" />).
// Слушает триггеры, спрашивает движок, рисует ярлычок, плашку, липкую панель и мультикнопку; окно – src/Dialog.tsx.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as E from './engine.ts';
import * as S from './state.ts';
import type { Widget } from './engine.ts';
import type { Config } from './state.ts';

interface Ui { show(id: string, as: string): void; hide(id: string): void; open(w: Widget | null): void; phone(v: boolean): void }
export interface Api { open(w: Widget): void; close(w: Widget, how: string): void; lead(w: Widget): void; contact(ch: string): void }
let api: Api;
type DialogFn = typeof import('./Dialog.tsx').default;

const NOT = (w: Widget, n: E.No) => S.log('not', E.name(w), n);
const metrika = (...a: unknown[]) => {
  const left = S.ym(...a);
  if (left >= 0) S.log('ym', a, left);
};

/** Логика без вида: проверка настроек, триггеры, решения движка. Возвращает уборку. */
function run(cfg: Config, ui: Ui): () => void {
  const c = S.init(cfg);
  ui.phone(c.phone);
  const off: (() => void)[] = [];
  const on = (t: EventTarget, ev: string, fn: (e: any) => void, o?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn, o);
    off.push(() => t.removeEventListener(ev, fn, o));
  };
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    off.push(() => clearTimeout(t));
  };
  const now = () => ({ ...c, now: Date.now() });
  const consentEv = cfg.consent?.event || 'gm-consent';
  S.metrika(cfg.metrika, !!S.readConsent(cfg)?.yandex);

  const ok: Widget[] = [];
  for (const w of cfg.widgets || []) {
    const n = E.validate(w) || E.match(w, c);
    if (n) NOT(w, n); else ok.push(w);
  }
  let openId = '';
  api = {
    open(w) {
      openId = w.id;
      S.acted(w);
      ui.open(w);
      metrika('params', { w: { [w.id]: 'open' } });
    },
    close(w, how) {
      if (openId === w.id) { openId = ''; ui.open(null); } else ui.hide(w.id);
      S.closed(w);
      S.log('close', E.name(w), how);
      metrika('params', { w: { [w.id]: 'close' } });
    },
    lead(w) {
      dispatchEvent(new CustomEvent('lead-sent', { detail: { source: 'w:' + w.id } }));
      metrika('reachGoal', w.goal || 'lead', { w: w.id });
    },
    contact(ch) { metrika('reachGoal', 'contact_click', { ch }); },
  };

  on(document, 'click', (e: Event) => {
    const el = (e.target as Element).closest?.('[data-w-open]');
    const w = el && ok.find((x) => x.id === el.getAttribute('data-w-open'));
    if (!w) return;
    e.preventDefault();
    S.log('click', E.name(w));
    api.open(w);
  });
  on(window, 'lead-sent', (e: CustomEvent) => {
    S.leadSent();
    S.log('lead', e.detail?.source || 'форма страницы');
    ok.forEach((w) => (w.group || 'lead') === 'lead' && E.isAuto(w) && ui.hide(w.id));
  });
  on(window, consentEv, (e: CustomEvent) => {
    if (!S.metrika(cfg.metrika, !!(e.detail?.yandex ?? S.readConsent(cfg)?.yandex))) S.log('flush');
  });

  // Сработавшие за один такт собираются вместе: из окон побеждает одно – с большим priority.
  let pending: [Widget, string, unknown][] = [];
  const flush = () => {
    const shows = pending.map(([w, how, x]) => [w, how, x, E.view(w, c)] as const);
    pending = [];
    const ovs = shows.filter((s) => E.isOverlay(s[3])).map((s) => s[0]);
    const win = ovs.length ? E.pick(ovs) : null;
    for (const [w, how, x, as] of shows) {
      const ov = E.isOverlay(as);
      if (ov && w !== win) { NOT(w, { code: 'race', p: [E.name(win!)] }); continue; }
      if (ov && openId) { NOT(w, { code: 'busy', p: [] }); continue; }
      S.shown(w, as);
      if (as !== w.type) S.log('as', E.name(w), as);
      S.log('show', E.name(w), how, x);
      metrika('params', { w: { [w.id]: 'show' } });
      if (ov) { openId = w.id; ui.open(w); } else ui.show(w.id, as);
    }
  };
  const fire = (w: Widget, how: string, x?: unknown, again = true) => {
    const n = E.allow(w, now(), S.mem);
    if (n?.code === 'early' && again) {
      S.log('wait', E.name(w), n);
      later(() => fire(w, how, x, false), E.waitMs(now()) + 20);
      return false;
    }
    if (n) return NOT(w, n), false;
    if (!pending.length) later(flush, 0);
    pending.push([w, how, x]);
    return true;
  };

  const arm = () => {
    for (const w of ok.filter(E.isAuto)) {
      const pre = E.allow(w, { ...c, now: Math.max(Date.now(), c.visitStart + E.QUIET_SEC * 1e3) }, S.mem);
      if (pre) { NOT(w, pre); continue; }
      const t = w.trigger || {};
      const kind = E.on(w);
      if (kind === 'load') fire(w, kind);
      if (kind === 'time') later(() => fire(w, kind, t.s ?? 40), (t.s ?? 40) * 1e3);
      if (kind === 'pages') S.pages >= (t.n || 2) ? fire(w, kind, S.pages) : S.log('armpages', E.name(w), t.n || 2);
      if (kind === 'scroll') {
        const fn = () => {
          const h = document.documentElement;
          if (((h.scrollTop + innerHeight) / h.scrollHeight) * 100 >= (t.pct ?? 50) && fire(w, kind, t.pct ?? 50)) removeEventListener('scroll', fn);
        };
        on(window, 'scroll', fn, { passive: true });
      }
      if (kind === 'block') {
        const el = t.sel && document.querySelector(t.sel);
        if (el) {
          const io = new IntersectionObserver((es) => es.some((y) => y.isIntersecting) && fire(w, kind, t.sel) && io.disconnect());
          io.observe(el);
          off.push(() => io.disconnect());
        }
      }
      if (kind === 'exit') {
        on(document, 'mouseout', (e: MouseEvent) => !e.relatedTarget && e.clientY <= 0 && fire(w, kind, 0, false));
        S.log('armexit', E.name(w));
      }
    }
  };
  if (c.cookieChosen) arm();
  else {
    S.log('cookie');
    on(window, consentEv, () => { c.cookieChosen = true; arm(); }, { once: true });
  }
  return () => off.forEach((f) => f());
}

export default function Widgets({ src = '/widgets.json', config }: { src?: string; config?: Config }) {
  const [cfg, setCfg] = useState(config);
  const [st, setSt] = useState<Record<string, string>>({});
  const [dlg, setDlg] = useState<Widget | null>(null);
  const [phone, setPhone] = useState(false);
  // Окно, квиз и форма грузятся отдельным куском при первом открытии: большинство визитов до них не доходит.
  const [D, setD] = useState<{ f: DialogFn } | null>(null);
  useEffect(() => { if (dlg && !D) import('./Dialog.tsx').then((m) => setD({ f: m.default })); }, [dlg]);
  useEffect(() => { if (!cfg) fetch(src).then((r) => r.json()).then(setCfg, () => {}); }, []);
  useEffect(() => cfg && run(cfg, {
    show: (id, as) => setSt((s) => ({ ...s, [id]: as })),
    hide: (id) => setSt((s) => { const n = { ...s }; delete n[id]; return n; }),
    open: setDlg,
    phone: setPhone,
  }), [cfg]);
  useEffect(() => { document.body.classList.toggle('w-has-sticky', phone && Object.values(st).includes('contacts')); }, [st, phone]);
  if (!cfg) return null;
  return (
    <div class={'w-root' + (phone ? ' is-phone' : '')}>
      {Object.entries(st).map(([id, as]) => {
        const w = cfg.widgets.find((x) => x.id === id)!;
        return as === 'bar' ? <Bar key={id} w={w} /> : as === 'contacts' ? <Contacts key={id} w={w} phone={phone} /> : <Tab key={id} w={w} phone={phone} />;
      })}
      {dlg && D && <D.f key={dlg.id} w={dlg} cfg={cfg} phone={phone} api={api} />}
    </div>
  );
}

const X = ({ w, how = 'x' }: { w: Widget; how?: string }) => (
  <button type="button" class="w-x" aria-label="Закрыть" onClick={() => api.close(w, how)}>×</button>
);

function Tab({ w, phone }: { w: Widget; phone: boolean }) {
  const k = w.content || {};
  return (
    <div class="w-tab" style={{ zIndex: E.LAYER.tab }}>
      <button type="button" class="w-tab__b" onClick={() => api.open(w)}>{(phone && k.short) || k.label || E.name(w)}</button>
      <X w={w} />
    </div>
  );
}

function Bar({ w }: { w: Widget }) {
  const k = w.content || {};
  const to = w.target?.dateTo;
  return (
    <div class="w-bar" role="region" aria-label={E.name(w)} style={{ zIndex: E.LAYER.bar }}>
      <p>{k.text || E.name(w)}{to && <b> до {E.dateText(to)}</b>}{k.link && <> · <a href={k.link.href}>{k.link.text}</a></>}</p>
      {E.isOverlay(w.type) && <button type="button" class="w-bar__b" onClick={() => api.open(w)}>{k.button || 'Открыть'}</button>}
      <X w={w} />
    </div>
  );
}

function Contacts({ w, phone }: { w: Widget; phone: boolean }) {
  const k = w.content || {};
  const [open, setOpen] = useState(false);
  const a = (ch: string, href = '', text: string, cls = '') => (
    <a class={cls} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener" onClick={() => api.contact(ch)}>{text}</a>
  );
  if (phone) {
    return (
      <nav class="w-sticky" aria-label="Связаться" style={{ zIndex: E.LAYER.sticky }}>
        {a('phone', 'tel:' + k.phone, 'Позвонить', 'w-btn')}
        {a('telegram', k.write || k.tg, 'Написать', 'w-btn w-btn--alt')}
      </nav>
    );
  }
  return (
    <div class="w-multi" style={{ zIndex: E.LAYER.sticky }}>
      {open && (
        <div class="w-multi__list">
          {k.tg && a('telegram', k.tg, 'Telegram')}
          {k.max && a('max', k.max, 'MAX')}
          {k.wa && a('whatsapp', k.wa, 'WhatsApp')}
          {a('phone', 'tel:' + k.phone, k.phoneText || k.phone)}
          {k.callback && <button type="button" data-w-open={k.callback}>Перезвоните мне</button>}
        </div>
      )}
      <button type="button" class="w-multi__b" aria-expanded={open} aria-label="Связаться с нами" onClick={() => { setOpen(!open); !open && S.acted(w); }}>
        {open ? '×' : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>}
      </button>
    </div>
  );
}

/** Для сборки без Astro: <div data-vidzhety data-src="widgets.json"></div> или в конец body. */
export function mount() {
  const el = document.querySelector<HTMLElement>('[data-vidzhety]') || document.body.appendChild(document.createElement('div'));
  render(<Widgets src={el.dataset.src} />, el);
}

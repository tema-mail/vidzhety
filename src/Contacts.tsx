// Связь: на телефоне – нижняя липкая панель (кнопки из настроек: главная кнопка страницы + «Позвонить»),
// на компьютере – боковая панель у правого края (layout:"side") или мультикнопка в углу.
import { useState } from 'preact/hooks';
import * as E from './engine.ts';
import * as S from './state.ts';
import type { Btn, Widget } from './engine.ts';
import type { Api } from './Widgets.tsx';

const ICON: Record<string, string> = {
  phone: 'M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z',
  whatsapp: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  telegram: 'M21 4 3 11l6 2 2 6 3-4 5 4zM9 13l12-9',
  mail: 'M3 6h18v12H3zm0 0 9 7 9-7',
  cb: 'M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2zM15 3h6v6m0-6-6 6',
};
const svg = (d: string) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const chOf = (h: string) => (h.startsWith('tel:') ? 'phone' : /wa\.me|whatsapp/.test(h) ? 'whatsapp' : /t\.me/.test(h) ? 'telegram' : /max\.ru/.test(h) ? 'max' : h.startsWith('mailto:') ? 'mail' : '');
const blank = (h: string) => (h.startsWith('http') ? '_blank' : undefined);

export default function Contacts({ w, phone, api }: { w: Widget; phone: boolean; api: Api }) {
  const k = w.content || {};
  const [open, setOpen] = useState(false);
  const a = (ch: string, href: string, text: any, cls = '', label?: string) => (
    <a class={cls} href={href} target={blank(href)} rel="noopener" aria-label={label} title={label} onClick={() => ch && api.contact(ch)}>{text}</a>
  );
  if (phone) return <nav class="vz-sticky" aria-label="Связаться" style={{ zIndex: E.LAYER.sticky }}>{E.buttons(k).map((b) => <PBtn b={b} a={a} />)}</nav>;
  if (k.layout === 'side') {
    return (
      <nav class="vz-side" aria-label="Связаться" style={{ zIndex: E.LAYER.sticky }}>
        {E.side(k).map(([ch, href, text]) => a(ch, href, <>{ch === 'max' ? <b>MAX</b> : svg(ICON[ch])}<span>{text}</span></>, 'vz-side--' + ch, text))}
        {k.callback && <button type="button" class="vz-side--cb" data-w-open={k.callback} aria-label="Перезвоните мне">{svg(ICON.cb)}<span>Перезвоните мне</span></button>}
      </nav>
    );
  }
  return (
    <div class="vz-multi" style={{ zIndex: E.LAYER.sticky }}>
      {open && (
        <div class="vz-multi__list">
          {E.side(k).map(([ch, href, text]) => a(ch, href, text))}
          {k.callback && <button type="button" data-w-open={k.callback}>Перезвоните мне</button>}
        </div>
      )}
      <button type="button" class="vz-multi__b" aria-expanded={open} aria-label="Связаться с нами" onClick={() => { setOpen(!open); !open && S.acted(w); }}>
        {open ? '×' : svg(ICON.whatsapp)}
      </button>
    </div>
  );
}

/** Кнопка нижней панели: ссылка, открыть виджет (data-w-open ловит исполнитель) или прокрутка к якорю. */
function PBtn({ b, a }: { b: Btn; a: (ch: string, href: string, text: any, cls?: string) => any }) {
  const cls = 'vz-btn' + (b.kind === 'main' ? ' vz-btn--main' : ' vz-btn--o');
  if (b.open) return <button type="button" class={cls} data-w-open={b.open}>{b.text}</button>;
  if (b.href) return a(chOf(b.href), b.href, b.text, cls);
  const go = (e: Event) => {
    const el = document.querySelector<HTMLElement>(b.scroll!);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };
  return <a class={cls} href={b.scroll} onClick={go}>{b.text}</a>;
}

// Окно и шторка виджета: квиз, форма заявки, обратный звонок. Грузится лениво из Widgets.tsx при первом открытии.
// Доступность: role=dialog, aria-modal, фокус внутри, Esc, тап мимо, «назад» (одна запись истории), крестик 44 px.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as E from './engine.ts';
import * as S from './state.ts';
import type { Widget } from './engine.ts';
import type { Config } from './state.ts';
import type { Api } from './Widgets.tsx';

type P = { w: Widget; cfg: Config; api: Api };

const FOCUS = 'a[href],button:not([disabled]),input,select,textarea';

/** Окно или шторка: Esc, тап мимо, крестик и «назад» закрывают; фокус не уходит из окна. */
export default function Dialog({ w, cfg, phone, api, auto = false }: P & { phone: boolean; auto?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = (how: string) => api.close(w, how);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    let pushed = true;
    history.pushState({ w: w.id }, '');
    const pop = () => { pushed = false; close('back'); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('esc');
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUS)];
      const [a, b] = [f[0], f[f.length - 1]];
      if (e.shiftKey ? document.activeElement === a : document.activeElement === b) { e.preventDefault(); (e.shiftKey ? b : a).focus(); }
    };
    addEventListener('popstate', pop);
    addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>(FOCUS)?.focus();
    return () => {
      removeEventListener('popstate', pop);
      removeEventListener('keydown', key);
      if (pushed) history.back();
      prev?.focus?.();
    };
  }, []);
  const side = phone ? 'sheet' : ['tab', 'sheet'].includes(w.type) ? 'side' : 'center';
  // Самопоявившаяся шторка – не выше 30% экрана; человек коснулся её – раскрывается под форму.
  const [low, setLow] = useState(auto);
  return (
    <div class={`vz-dlg vz-dlg--${side}${low ? ' is-auto' : ''}`} style={{ zIndex: E.LAYER.overlay }}>
      <div class="vz-dlg__bg" onClick={() => close('bg')} />
      <div class="vz-dlg__p" onPointerDown={() => setLow(false)} ref={ref} role="dialog" aria-modal="true" aria-labelledby={'w-t-' + w.id}>
        <button type="button" class="vz-x" aria-label="Закрыть" onClick={() => close('x')}>×</button>
        <Body w={w} cfg={cfg} api={api} />
      </div>
    </div>
  );
}

type Step = { q: string; options: { t: string; r?: string }[] };

function Body({ w, cfg, api }: P) {
  const k = w.content || {};
  const qz: Step[] | undefined = k.quiz;
  const [step, setStep] = useState(0);
  const [ans, setAns] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  // Сменился шаг – фокус на заголовок, чтобы клавиатура не выпала из окна на страницу.
  useEffect(() => { document.getElementById('w-t-' + w.id)?.focus(); }, [step, done]);
  const h = (t: ComponentChildren) => <h2 class="vz-h" id={'w-t-' + w.id} tabIndex={-1}>{t}</h2>;
  if (done) return <>{h(k.done || 'Заявка принята')}<p>{k.doneText || E.term(w, Date.now(), cfg.tz ?? 3)}</p>{cfg.endpoint === 'demo:' && <p class="vz-demo">демо: заявка никуда не ушла</p>}</>;
  const back = (to: number) => <button type="button" class="vz-back" onClick={() => setStep(to)}>← Назад</button>;
  if (qz && step < qz.length) {
    const s = qz[step];
    return (
      <>
        <p class="vz-step">Шаг {step + 1} из {qz.length + 1}</p>
        {h(s.q)}
        <div class="vz-opts">
          {s.options.map((o) => (
            <button type="button" class={ans[step] === o.t ? 'is-on' : ''} onClick={() => { const a = [...ans]; a[step] = o.t; setAns(a); setStep(step + 1); }}>{o.t}</button>
          ))}
        </div>
        {step > 0 && back(step - 1)}
      </>
    );
  }
  const res = qz ? qz.map((s, i) => s.options.find((o) => o.t === ans[i])?.r).filter(Boolean).join(', ') : '';
  const extra = qz ? Object.fromEntries(qz.map((s, i) => [s.q, ans[i]])) : {};
  return (
    <>
      {h(qz ? k.resultTitle || 'Ваш ориентир' : k.title || E.name(w))}
      {res && <p class="vz-res">{res}</p>}
      {w.type === 'callback' ? <p>{E.term(w, Date.now(), cfg.tz ?? 3)}</p> : k.text && <p>{k.text}</p>}
      <Form w={w} cfg={cfg} api={api} extra={extra} done={() => setDone(true)} />
      {qz && back(qz.length - 1)}
    </>
  );
}

const LABEL: Record<string, [string, string, string]> = {
  name: ['Ваше имя', 'text', 'name'], phone: ['Телефон', 'tel', 'tel'], email: ['Почта', 'email', 'email'],
};
function mask(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d[0] === '8') d = '7' + d.slice(1);
  if (d[0] !== '7') d = '7' + d;
  const p = d.slice(1, 11);
  let o = '+7';
  if (p) o += ' (' + p.slice(0, 3);
  if (p.length >= 3) o += ')';
  if (p.length > 3) o += ' ' + p.slice(3, 6);
  if (p.length > 6) o += '-' + p.slice(6, 8);
  if (p.length > 8) o += '-' + p.slice(8, 10);
  return o;
}

/** Форма: пустая галочка ПДн со ссылкой на документ, кнопка неактивна до отметки; рассылка – отдельной пустой галочкой. */
function Form({ w, cfg, api, extra, done }: P & { extra: Record<string, string>; done: () => void }) {
  const f = w.form || {};
  const fields = f.fields || ['phone'];
  const [v, setV] = useState<Record<string, string>>({});
  const [agree, setAgree] = useState(false);
  const [mk, setMk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!agree) return setErr('Отметьте согласие на обработку данных');
    if (fields.includes('phone') && (v.phone || '').replace(/\D/g, '').length !== 11) return setErr('Укажите телефон полностью');
    if (fields.includes('email') && !/^\S+@\S+\.\S+$/.test(v.email || '')) return setErr('Проверьте почту');
    setBusy(true);
    const data: Record<string, string> = { ...extra };
    for (const k of fields) data[k[0].toUpperCase() + k.slice(1)] = v[k] || '';
    const ok = await S.send(cfg, w, data, mk);
    setBusy(false);
    if (!ok) return setErr('Не получилось отправить. Позвоните нам или напишите в мессенджер');
    api.lead(w);
    done();
  };
  const box = (on: boolean, set: (b: boolean) => void, text: ComponentChildren) => (
    <label class="vz-chk"><input type="checkbox" checked={on} onChange={(e) => set((e.target as HTMLInputElement).checked)} /><span>{text}</span></label>
  );
  return (
    <form class="vz-form" onSubmit={submit} noValidate>
      {fields.map((k) => (
        <label class="vz-f" key={k}>
          <span>{LABEL[k][0]}</span>
          <input type={LABEL[k][1]} autoComplete={LABEL[k][2]} inputMode={k === 'phone' ? 'tel' : undefined} placeholder={k === 'phone' ? '+7 (___) ___-__-__' : ''}
            value={v[k] || ''} onInput={(e) => { const t = (e.target as HTMLInputElement).value; setV({ ...v, [k]: k === 'phone' ? mask(t) : t }); setErr(''); }} />
        </label>
      ))}
      {box(agree, setAgree, <>Даю <a href={cfg.agreement || '/soglasie'} target="_blank">согласие на обработку персональных данных</a></>)}
      {f.marketing && box(mk, setMk, <>Согласен(на) получать рекламные письма (<a href={cfg.marketingDoc || '/soglasie-rassylka'} target="_blank">согласие на рассылку</a>)</>)}
      {err && <p class="vz-err" role="alert">{err}</p>}
      <button class="vz-btn" type="submit" disabled={busy || !agree}>{busy ? 'Отправляем…' : f.button || 'Отправить'}</button>
      {cfg.endpoint === 'demo:' && <p class="vz-demo">демо, заявка никуда не уходит</p>}
    </form>
  );
}

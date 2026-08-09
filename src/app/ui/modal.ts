/**
 * Minimal modal dialog helper.
 */

export interface ModalField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'file';
  value?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  accept?: string;
}

export interface ModalResult {
  [key: string]: string | number | boolean | File | null;
}

/** Show a modal; resolves with values on OK, null on cancel. */
export function showModal(
  title: string,
  fields: ModalField[],
  okLabel = 'OK',
  bodyHtml = '',
): Promise<ModalResult | null> {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root')!;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h2>${title}</h2><div class="modal-body"></div>
      <div class="modal-actions">
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="ok">${okLabel}</button>
      </div>`;
    const body = modal.querySelector('.modal-body')!;
    if (bodyHtml) {
      const info = document.createElement('div');
      info.className = 'hint';
      info.innerHTML = bodyHtml;
      body.appendChild(info);
    }
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.label;
      row.appendChild(label);
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const opt of f.options ?? []) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          input.appendChild(o);
        }
        input.value = String(f.value ?? f.options?.[0]?.value ?? '');
      } else {
        input = document.createElement('input');
        input.type = f.type;
        if (f.type === 'checkbox') {
          input.checked = Boolean(f.value);
        } else if (f.type === 'file') {
          if (f.accept) input.accept = f.accept;
        } else {
          input.value = String(f.value ?? '');
          if (f.min !== undefined) input.min = String(f.min);
          if (f.max !== undefined) input.max = String(f.max);
          if (f.step !== undefined) input.step = String(f.step);
        }
      }
      inputs.set(f.key, input);
      row.appendChild(input);
      body.appendChild(row);
    }
    const close = (result: ModalResult | null): void => {
      backdrop.remove();
      resolve(result);
    };
    modal.querySelector('[data-act="cancel"]')!.addEventListener('click', () => close(null));
    modal.querySelector('[data-act="ok"]')!.addEventListener('click', () => {
      const out: ModalResult = {};
      for (const f of fields) {
        const input = inputs.get(f.key)!;
        if (f.type === 'checkbox') out[f.key] = (input as HTMLInputElement).checked;
        else if (f.type === 'number') out[f.key] = parseFloat(input.value) || 0;
        else if (f.type === 'file') out[f.key] = (input as HTMLInputElement).files?.[0] ?? null;
        else out[f.key] = input.value;
      }
      close(out);
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
    (inputs.values().next().value as HTMLElement | undefined)?.focus();
  });
}

/** Simple message toast in the status bar area. */
export function toast(message: string, isError = false): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `position:fixed;bottom:44px;left:50%;transform:translateX(-50%);
    background:${isError ? '#5a2626' : '#26323f'};color:#e8ecf1;padding:8px 18px;
    border-radius:8px;font-size:13px;z-index:200;box-shadow:0 6px 18px rgb(0 0 0/45%);
    border:1px solid ${isError ? '#a04545' : '#3c5064'}`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 450);
  }, 2600);
}

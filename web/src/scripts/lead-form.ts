// Envío de formularios de prospectos.
// - Si el <form> tiene data-endpoint, se envía JSON por POST a la función siia-cotizaciones (se guarda en el panel
//   › Cotizaciones y llega por correo). data-origen dice si es COTIZACION o CONTACTO.
// - Si no, se abre WhatsApp (si el <form> tiene data-whatsapp) o el correo con el mensaje ya redactado para que el prospecto lo envíe.

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function labelFor(form: HTMLFormElement, el: Field): string {
  const fieldset = el.closest('fieldset');
  if (fieldset) return fieldset.querySelector('legend')?.textContent?.trim() ?? el.name;
  return form.querySelector(`label[for="${el.id}"]`)?.textContent?.replace('*', '').trim() ?? el.name;
}

function collect(form: HTMLFormElement) {
  const data: Record<string, string> = {};
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(form.elements) as Field[]) {
    if (!el.name || el.type === 'submit' || el.name === 'consentimiento' || el.name === 'sitio_web' || seen.has(el.name)) continue;
    seen.add(el.name);
    let value: string;
    if (el.type === 'checkbox' || el.type === 'radio') {
      value = Array.from(form.querySelectorAll<HTMLInputElement>(`[name="${el.name}"]:checked`))
        .map((i) => i.value)
        .join(', ');
    } else {
      value = el.value.trim();
    }
    if (!value) continue;
    data[el.name] = value;
    lines.push(`*${labelFor(form, el)}:* ${value}`);
  }
  return { data, lines };
}

function validate(form: HTMLFormElement): boolean {
  let firstInvalid: Field | null = null;
  for (const el of Array.from(form.elements) as Field[]) {
    if (!('checkValidity' in el) || !el.willValidate) continue;
    const error = el.closest('.field')?.querySelector<HTMLElement>('.error');
    const ok = el.checkValidity();
    el.setAttribute('aria-invalid', String(!ok));
    if (error) error.textContent = ok ? '' : el.validationMessage;
    if (!ok && !firstInvalid) firstInvalid = el;
  }
  firstInvalid?.focus();
  return !firstInvalid;
}

export function initLeadForms() {
  document.querySelectorAll<HTMLFormElement>('[data-lead-form]').forEach((form) => {
    form.noValidate = true;
    const status = form.querySelector<HTMLElement>('[data-status]');
    const showStatus = (msg: string, error = false) => {
      if (!status) return;
      status.textContent = msg;
      status.classList.toggle('is-error', error);
      status.hidden = false;
    };
    const boton = form.querySelector<HTMLButtonElement>('button[type="submit"]');

    form.addEventListener('input', (e) => {
      const el = e.target as Field;
      if (el.getAttribute('aria-invalid') === 'true' && el.checkValidity()) {
        el.setAttribute('aria-invalid', 'false');
        const error = el.closest('.field')?.querySelector<HTMLElement>('.error');
        if (error) error.textContent = '';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate(form)) return;
      const { data, lines } = collect(form);
      const subject = form.dataset.subject ?? 'Contacto desde el sitio web';

      if (form.dataset.endpoint) {
        if (boton) boton.disabled = true;
        try {
          const trampa = form.querySelector<HTMLInputElement>('[name="sitio_web"]')?.value ?? '';
          const res = await fetch(form.dataset.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, origen: form.dataset.origen, ...data, sitio_web: trampa, page: location.pathname }),
          });
          const r = await res.json().catch(() => ({}));
          // Datos incompletos o demasiados envíos: se explica y se deja corregir.
          if (res.status >= 400 && res.status < 500 && r?.error) {
            showStatus(r.error, true);
            return;
          }
          if (!res.ok) throw new Error(String(res.status));
          form.reset();
          showStatus('¡Gracias! Recibimos tu solicitud y un asesor de SIIA te contactará muy pronto.');
          return;
        } catch {
          // Si el envío falla (sin conexión o error del servidor), se ofrece WhatsApp o correo como respaldo.
        } finally {
          if (boton) boton.disabled = false;
        }
      }

      const text = [`Hola SIIA, ${subject.toLowerCase()}.`, '', ...lines].join('\n');
      if (form.dataset.whatsapp) {
        const url = `https://wa.me/${form.dataset.whatsapp}?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank', 'noopener');
        showStatus(
          'Abrimos WhatsApp con tu mensaje listo. Solo presiona "Enviar" y un asesor de SIIA te responderá. Si no se abrió, escríbenos a info@siia.casa.',
        );
        return;
      }
      // Correo sin los asteriscos de negritas de WhatsApp.
      const body = text.replace(/\*/g, '');
      location.href = `mailto:info@siia.casa?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      showStatus(
        'Abrimos tu correo con el mensaje listo. Solo presiona "Enviar" y un asesor de SIIA te responderá. Si no se abrió, escríbenos a info@siia.casa.',
      );
    });
  });
}

/* =========================================================
   form.js
   Contact form — client-side validation + Web3Forms submission.

   Failing fields get aria-invalid="true" with paired error
   messages via aria-describedby in the markup. Status line in
   #formStatus is announced via aria-live for screen readers.

   Honeypot field "botcheck" silently filters most spam at the
   Web3Forms side — bots fill the hidden checkbox; humans don't.
   ========================================================= */

(function () {
  'use strict';

  const form   = document.getElementById('contactForm');
  const status = document.getElementById('formStatus');
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');

  // --- Web3Forms config ---
  const W3F_ACCESS_KEY = '8b85535a-0634-4fd6-b39e-63aa75eb7995';
  const W3F_ENDPOINT   = 'https://api.web3forms.com/submit';

  // Clear a field's invalid state as soon as the user starts editing it.
  form.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('input',  () => clearInvalid(field));
    field.addEventListener('change', () => clearInvalid(field));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fields = {
      name:     form.querySelector('[name="name"]'),
      email:    form.querySelector('[name="email"]'),
      interest: form.querySelector('[name="interest"]'),
      message:  form.querySelector('[name="message"]'),
    };

    // --- Validate ---
    const errors = [];
    if (!fields.name.value.trim())                                     { markInvalid(fields.name);     errors.push('name'); }
    if (!fields.email.value.trim() || !isValidEmail(fields.email.value)) { markInvalid(fields.email);    errors.push('email'); }
    if (!fields.interest.value)                                        { markInvalid(fields.interest); errors.push('interest'); }
    if (!fields.message.value.trim())                                  { markInvalid(fields.message);  errors.push('message'); }

    if (errors.length) {
      const summary = errors.length === 1
        ? 'Please fix the highlighted field above.'
        : `Please fix the ${errors.length} highlighted fields above.`;
      setStatus(summary, 'error');
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }

    // --- Submit to Web3Forms ---
    const data = new FormData(form);
    data.append('access_key', W3F_ACCESS_KEY);

    // Subject line: easy to scan in inbox
    const interestValue = (data.get('interest') || '').toString();
    const submitterName = fields.name.value.trim();
    data.append('subject', `New inquiry — ${submitterName} (${interestValue})`);

    // Optional source tag if the form is reused on multiple pages
    if (form.dataset.formSource) {
      data.append('form_source', form.dataset.formSource);
    }

    // Disable submit + show pending state
    const originalLabel = submit.innerHTML;
    submit.disabled  = true;
    submit.innerHTML = 'Sending…';
    setStatus('Sending your message…', 'pending');

    try {
      const response = await fetch(W3F_ENDPOINT, {
        method: 'POST',
        body: data
      });
      const json = await response.json().catch(() => ({}));

      if (response.ok && json.success) {
        setStatus('Thank you. I will be in touch shortly.', 'ok');
        form.reset();
      } else {
        setStatus(json.message || 'Something went wrong. Please try again.', 'error');
      }
    } catch (err) {
      setStatus('Network error. Please check your connection and try again.', 'error');
    } finally {
      submit.disabled  = false;
      submit.innerHTML = originalLabel;
    }
  });

  function markInvalid(el) {
    el.setAttribute('aria-invalid', 'true');
  }

  function clearInvalid(el) {
    if (el.getAttribute('aria-invalid') === 'true') {
      el.removeAttribute('aria-invalid');
    }
  }

  function setStatus(msg, kind) {
    if (!status) return;
    status.textContent = msg;
    status.style.color = kind === 'error'
      ? '#b03a2e'
      : 'rgba(11, 22, 40, 0.7)';
  }

  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
  }
})();

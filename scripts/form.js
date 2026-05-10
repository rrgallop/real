/* =========================================================
   form.js
   Contact form — placeholder client-side validation + status.
   Wire up to a backend / form service later (Formspree,
   Netlify Forms, custom endpoint).
   ========================================================= */

(function () {
  'use strict';

  const form   = document.getElementById('contactForm');
  const status = document.getElementById('formStatus');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());

    // Light client-side validation
    if (!data.name || !data.email || !data.message || !data.interest) {
      setStatus('Please complete the required fields.', 'error');
      return;
    }
    if (!data.consent) {
      setStatus('Please confirm consent to be contacted.', 'error');
      return;
    }
    if (!isValidEmail(data.email)) {
      setStatus('Please enter a valid email address.', 'error');
      return;
    }

    // Placeholder success — replace with real submission later.
    setStatus('Thank you. I will be in touch shortly.', 'ok');
    form.reset();
  });

  function setStatus(msg, kind) {
    if (!status) return;
    status.textContent = msg;
    status.style.color = kind === 'error'
      ? 'rgba(180, 60, 60, 0.9)'
      : 'rgba(11, 22, 40, 0.7)';
  }

  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
  }
})();

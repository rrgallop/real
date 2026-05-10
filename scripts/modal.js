/* =========================================================
   modal.js
   Generic modal handler. Any element with [data-modal-open]
   opens the modal whose id matches the attribute value.
   Closes on backdrop click, Escape key, or [data-modal-close].
   Locks body scroll while open. Restores focus on close.
   ========================================================= */

(function () {
  'use strict';

  let lastFocused = null;

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-modal-open]');
    if (opener) {
      e.preventDefault();
      const id = opener.getAttribute('data-modal-open');
      open(id, opener);
      return;
    }

    const closer = e.target.closest('[data-modal-close]');
    if (closer) {
      e.preventDefault();
      const modal = closer.closest('.modal');
      if (modal) close(modal);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal:not([hidden])');
    if (open) close(open);
  });

  function open(id, opener) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocused = opener || document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    // Focus the close button so keyboard users can dismiss easily
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function close(modal) {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }
})();

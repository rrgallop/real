/* =========================================================
   nav.js
   Mobile drawer toggle + reveal-on-scroll observer.
   ========================================================= */

(function () {
  'use strict';

  // ---------- Mobile drawer ----------
  const toggle = document.getElementById('navToggle');
  const drawer = document.getElementById('navDrawer');

  if (toggle && drawer) {
    const openDrawer = () => {
      drawer.setAttribute('data-open', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      // Move focus into the drawer so keyboard users can navigate it
      const firstLink = drawer.querySelector('a');
      if (firstLink) firstLink.focus();
    };

    const closeDrawer = ({ returnFocus = true } = {}) => {
      drawer.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      if (returnFocus) toggle.focus();
    };

    toggle.addEventListener('click', () => {
      const isOpen = drawer.getAttribute('data-open') === 'true';
      isOpen ? closeDrawer() : openDrawer();
    });

    // Close drawer when a link is activated (don't return focus —
    // the user is navigating to a section)
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        closeDrawer({ returnFocus: false });
      });
    });

    // Close on Escape and trap Tab focus inside drawer while open
    document.addEventListener('keydown', (e) => {
      const isOpen = drawer.getAttribute('data-open') === 'true';
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer();
        return;
      }

      if (e.key === 'Tab') {
        const focusables = drawer.querySelectorAll('a, button');
        if (!focusables.length) return;
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];

        // Wrap focus from last → first (or first → last on Shift+Tab)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  // ---------- Reveal on scroll ----------
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = document.querySelectorAll('.reveal');

  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  reveals.forEach(el => observer.observe(el));

  // ---------- Floating CTA visibility ----------
  // Visible only between hero and the contact/footer zone. Hidden
  // when hero, contact, or footer is in view — each is its own
  // "destination" and the persistent CTA would either be redundant
  // (contact has its own form) or obscure content (footer).
  const cta     = document.getElementById('floatingCta');
  const hero    = document.querySelector('.hero');
  const contact = document.getElementById('contact');
  const footer  = document.querySelector('.site-footer');

  if (cta && hero && contact && footer) {
    let heroInView    = true;     // page loads with hero in view
    let contactInView = false;
    let footerInView  = false;

    const updateCta = () => {
      const shouldShow = !heroInView && !contactInView && !footerInView;
      cta.classList.toggle('is-visible', shouldShow);
    };

    new IntersectionObserver(([entry]) => {
      heroInView = entry.isIntersecting;
      updateCta();
    }, { threshold: 0.15 }).observe(hero);

    new IntersectionObserver(([entry]) => {
      contactInView = entry.isIntersecting;
      updateCta();
    }, { threshold: 0.18 }).observe(contact);

    // Low threshold — hide as soon as any sliver of footer enters view,
    // before the CTA can overlap legal text or social icons.
    new IntersectionObserver(([entry]) => {
      footerInView = entry.isIntersecting;
      updateCta();
    }, { threshold: 0.01 }).observe(footer);
  }
})();

/* =========================================================
   logo-mark.js
   Animates any element marked [data-constellation]: nodes light
   up sequentially from center outward, edges draw in, then the
   inner ring settles into a slow ambient pulse.

   Multi-instance safe — uses class selectors, scoped to each
   root, so the hero mark and footer lockup animate independently.
   Honors prefers-reduced-motion.
   ========================================================= */

(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const roots = document.querySelectorAll('[data-constellation]');
  if (!roots.length) return;

  roots.forEach(setup);

  function setup(root) {
    const refs = collectRefs(root);

    if (reduced) {
      showAtRest(refs);
      return;
    }

    // Pre-set edge dasharray so they can draw in
    refs.allEdgeLines.forEach(({ line, length }) => {
      line.style.strokeDasharray  = length;
      line.style.strokeDashoffset = length;
    });

    // Trigger when the root is meaningfully in view.
    // Threshold 0.7 = ~70% visible before the reveal starts —
    // prevents the animation from playing while the mark is
    // still partially below the fold.
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setTimeout(() => play(refs), 220);
            observer.disconnect();
          }
        });
      }, { threshold: 0.7 });
      obs.observe(root);
    } else {
      play(refs);
    }
  }

  function collectRefs(root) {
    const center      = root.querySelector('.lm-center');
    const innerEdges  = root.querySelector('.lm-edges-inner');
    const innerNodes  = root.querySelector('.lm-nodes-inner');
    const hexEdges    = root.querySelector('.lm-edges-hex');
    const outerEdges  = root.querySelector('.lm-edges-outer');
    const outerNodes  = root.querySelector('.lm-nodes-outer');

    // [element, finalOpacity, delayMs]
    const targets = [
      [center,     1.0,   200],
      [innerEdges, 0.9,   480],
      [innerNodes, 0.95,  720],
      [hexEdges,   0.4,   1040],
      [outerEdges, 0.5,   1300],
      [outerNodes, 0.5,   1520]
    ];

    const allEdgeLines = [];
    [innerEdges, hexEdges, outerEdges].forEach(group => {
      if (!group) return;
      group.querySelectorAll('line').forEach(line => {
        allEdgeLines.push({ line, length: lineLength(line) });
      });
    });

    return { center, innerEdges, innerNodes, hexEdges, outerEdges, outerNodes, targets, allEdgeLines };
  }

  function play(refs) {
    refs.targets.forEach(([el, finalOpacity, delay]) => {
      if (!el) return;
      el.style.transition = 'opacity 700ms cubic-bezier(0.22, 0.61, 0.36, 1)';
      setTimeout(() => { el.style.opacity = finalOpacity; }, delay);
    });

    refs.allEdgeLines.forEach((entry, i) => {
      const baseDelay = 360 + i * 60;
      entry.line.style.transition = 'stroke-dashoffset 900ms cubic-bezier(0.22, 0.61, 0.36, 1)';
      setTimeout(() => { entry.line.style.strokeDashoffset = '0'; }, baseDelay);
    });

    setTimeout(() => startPulse(refs), 2200);
  }

  function startPulse(refs) {
    if (refs.innerNodes) {
      refs.innerNodes.querySelectorAll('circle').forEach((node, i) => {
        node.style.transformOrigin = 'center';
        node.style.transformBox    = 'fill-box';
        node.animate(
          [
            { transform: 'scale(1)',    opacity: 0.95 },
            { transform: 'scale(1.18)', opacity: 1.0  },
            { transform: 'scale(1)',    opacity: 0.95 }
          ],
          {
            duration: 3600 + i * 240,
            delay:    i * 280,
            iterations: Infinity,
            easing: 'cubic-bezier(0.65, 0, 0.35, 1)'
          }
        );
      });
    }

    if (refs.center) {
      refs.center.style.transformOrigin = 'center';
      refs.center.style.transformBox    = 'fill-box';
      refs.center.animate(
        [
          { transform: 'scale(1)',   opacity: 1.0 },
          { transform: 'scale(1.1)', opacity: 1.0 },
          { transform: 'scale(1)',   opacity: 1.0 }
        ],
        {
          duration: 5200,
          iterations: Infinity,
          easing: 'cubic-bezier(0.65, 0, 0.35, 1)'
        }
      );
    }
  }

  function showAtRest(refs) {
    const restState = [
      [refs.outerEdges, 0.5],
      [refs.hexEdges,   0.4],
      [refs.innerEdges, 0.9],
      [refs.outerNodes, 0.5],
      [refs.innerNodes, 0.95],
      [refs.center,     1.0]
    ];
    restState.forEach(([el, op]) => {
      if (el) el.style.opacity = op;
    });
  }

  function lineLength(line) {
    const x1 = parseFloat(line.getAttribute('x1'));
    const y1 = parseFloat(line.getAttribute('y1'));
    const x2 = parseFloat(line.getAttribute('x2'));
    const y2 = parseFloat(line.getAttribute('y2'));
    return Math.hypot(x2 - x1, y2 - y1);
  }
})();

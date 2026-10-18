/* ============================================================================
   expo-cisco-anyconnect — site behaviour
   Progressive enhancement only: with JavaScript disabled the page still reads
   and navigates correctly (all tabs' first panel shows, nothing is hidden by
   the reveal animation, and the mobile nav falls back to the scrollable page).
   ========================================================================= */

(function () {
  'use strict';

  var prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- header */

  var header = document.querySelector('[data-header]');

  if (header) {
    var syncHeader = function () {
      header.setAttribute('data-scrolled', String(window.scrollY > 8));
    };
    syncHeader();
    window.addEventListener('scroll', syncHeader, { passive: true });
  }

  /* --------------------------------------------------------- mobile nav */

  var navToggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');

  if (navToggle && nav) {
    var setNavOpen = function (open) {
      nav.setAttribute('data-open', String(open));
      navToggle.setAttribute('aria-expanded', String(open));
    };

    setNavOpen(false);

    navToggle.addEventListener('click', function () {
      setNavOpen(nav.getAttribute('data-open') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target instanceof Element && event.target.closest('a')) {
        setNavOpen(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        setNavOpen(false);
        navToggle.focus();
      }
    });

    document.addEventListener('click', function (event) {
      if (nav.getAttribute('data-open') !== 'true') return;
      if (!(event.target instanceof Node)) return;
      if (nav.contains(event.target) || navToggle.contains(event.target)) return;
      setNavOpen(false);
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 720) setNavOpen(false);
    });
  }

  /* ------------------------------------------------------------- copy */

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();

    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return legacyCopy(text);
        }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (button) {
    var source = document.getElementById(button.getAttribute('data-copy') || '');
    var label = button.querySelector('[data-copy-label]');

    if (!source) return;

    button.addEventListener('click', function () {
      var text = (source.textContent || '').trim();

      copyText(text).then(function (ok) {
        if (!ok) return;

        button.setAttribute('data-copied', 'true');
        if (label) label.textContent = 'Copied';

        window.setTimeout(function () {
          button.removeAttribute('data-copied');
          if (label) label.textContent = 'Copy';
        }, 1800);
      });
    });
  });

  /* ------------------------------------------------------------- tabs */

  Array.prototype.forEach.call(document.querySelectorAll('[role="tablist"]'), function (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length === 0) return;

    function panelFor(tab) {
      return document.getElementById(tab.getAttribute('aria-controls') || '');
    }

    function activate(tab, focus) {
      tabs.forEach(function (candidate) {
        var selected = candidate === tab;
        var panel = panelFor(candidate);
        candidate.setAttribute('aria-selected', String(selected));
        candidate.tabIndex = selected ? 0 : -1;
        if (panel) panel.hidden = !selected;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        activate(tab, false);
      });

      tab.addEventListener('keydown', function (event) {
        var next = null;

        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === 'Home') next = tabs[0];
        else if (event.key === 'End') next = tabs[tabs.length - 1];

        if (!next) return;
        event.preventDefault();
        activate(next, true);
      });
    });

    activate(tabs[0], false);
  });

  /* ----------------------------------------------------------- reveal */

  var revealables = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));

  if (revealables.length > 0 && 'IntersectionObserver' in window && !prefersReducedMotion) {
    var markVisible = function (element) {
      element.classList.add('is-visible');
    };

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          markVisible(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );

    // The class is only added once we know we can take it away again.
    revealables.forEach(function (element) {
      element.classList.add('reveal');
    });

    // Anything already on screen is revealed synchronously so the first paint never depends on an
    // IntersectionObserver callback — some environments never deliver one.
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    revealables.forEach(function (element) {
      var rect = element.getBoundingClientRect();
      var onScreen = rect.top < viewportHeight * 0.94 && rect.bottom > 0;

      if (onScreen) markVisible(element);
      else observer.observe(element);
    });

    // Failsafe: content must never be left invisible if the observer stays silent.
    window.setTimeout(function () {
      revealables.forEach(function (element) {
        if (!element.classList.contains('is-visible')) markVisible(element);
      });
    }, 1500);
  }

  /* ------------------------------------------------------------- year */

  Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (node) {
    node.textContent = String(new Date().getFullYear());
  });
})();

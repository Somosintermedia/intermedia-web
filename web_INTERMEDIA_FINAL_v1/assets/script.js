(() => {
  const btn = document.querySelector('.nav-toggle');
  const menu = document.getElementById('mobileMenu');
  if (!btn || !menu) return;

  const setState = (open) => {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
  };

  btn.addEventListener('click', () => {
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    setState(!isOpen);
  });

  // Close on link click (mobile)
  menu.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) setState(false);
  });

  // Close on resize up to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) setState(false);
  });
})();
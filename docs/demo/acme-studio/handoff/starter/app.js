// Starter behaviour: mobile navigation toggle. Refine as needed.
for (const t of document.querySelectorAll('.nav-toggle')) {
  t.addEventListener('click', () => { const nav = document.getElementById(t.getAttribute('aria-controls')); const open = nav.classList.toggle('is-open'); t.setAttribute('aria-expanded', String(open)); });
}

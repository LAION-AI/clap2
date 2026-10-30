/* ================= Closer above the share row: two big statements, keynote style ================= */
// Renders the page's closer into every .pl: "SOTA · CLAP model." beside "Open. · weights, data and code."
// When one comes into view the first half appears, then the second.
(function punchline() {
  const roots = document.querySelectorAll('.pl');
  if (!roots.length) return;

  const html = `
    <p class="pl-eye rv">CLAP2 · LAION-Audio-XL</p>
    <div class="pl-pair">
      <div class="pl-half rv d1"><span class="pl-hero pl-gr" title="State of the art">SOTA</span><span class="pl-of">CLAP model.</span></div>
      <div class="pl-half rv d2"><span class="pl-hero pl-gb">Open.</span><span class="pl-of">weights, data and code.</span></div>
    </div>`;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  roots.forEach(root => {
    root.innerHTML = html;
    if (reduced) { root.classList.add('on'); return; }
    new IntersectionObserver(([e], io) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      root.classList.add('on');
    }, { threshold: .5 }).observe(root);
  });
})();

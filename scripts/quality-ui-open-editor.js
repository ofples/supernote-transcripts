(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  if (root?.querySelector('[aria-label="Back"]')) root.querySelector('[aria-label="Back"]').click();
  setTimeout(() => document.querySelector('.st-fullscreen-modal [aria-label="Configure Demo"]')?.click(), 150);
})();

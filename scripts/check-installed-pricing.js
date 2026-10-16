(() => {
  const root = document.querySelector('.st-fullscreen-modal');
  root.querySelector('[aria-label="Costs"]').click();
  const pricing = root.querySelector('.st-standard-pricing').innerText;
  if (!pricing.includes('Standard') || root.querySelector('.st-pricing').open) throw Error('Pricing presentation');
  const p=app.plugins.plugins['nomad-transcripts'];
  return {version:p.manifest.version, pricing, customPricingCollapsed:true, requests:p.costs.total.requests, ai:p.aiEnabled, automatic:p.autoEnabled};
})();

(() => {
  const root = document.querySelector('.st-fullscreen-modal');
  const cue = root.querySelector('.st-queue-link');
  const label = cue.querySelector('.st-queue-hint').getBoundingClientRect();
  const arrow = cue.querySelector('.st-queue-arrow').getBoundingClientRect();
  if (Math.abs((label.top + label.bottom) / 2 - (arrow.top + arrow.bottom) / 2) > 2) throw Error('Queue cue alignment');
  root.querySelector('[aria-label="Open queue"]').click();
  const p = app.plugins.plugins['nomad-transcripts'];
  const queue = p.queueView;
  if (p.task || p.aiEnabled || p.autoEnabled || document.querySelector('.st-working')) throw Error('Unexpected live work');
  const bars = [...root.querySelectorAll('[role="progressbar"]')];
  if (queue.waiting.length && !bars.length) throw Error('Queue progress missing');
  return {version:p.manifest.version, cueAligned:true, waiting:queue.waiting.length, savedPageProgress:bars.map(x=>x.getAttribute('aria-valuenow')), iconActions:root.querySelectorAll('.st-queue-controls .st-icon-button').length, ai:false, idle:true};
})();

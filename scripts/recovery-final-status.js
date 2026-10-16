(() => {
  const plugin = app.plugins.plugins["nomad-transcripts"];
  const fixtures = [
    "nomad-transcripts-ui-fixture",
    "nomad-subscription-test",
  ];
  const modal = document.querySelector(".modal-container");
  const closeButtons = modal ? modal.querySelectorAll("button[aria-label*='Close'], .modal-close-button").length : 0;
  return {
    version: plugin?.manifest?.version ?? null,
    connected: !!plugin?.subscriptionStatus?.connected,
    idle: !!plugin && !plugin.task,
    paused: !!plugin?.progress?.paused,
    modalPresent: !!modal,
    modalCloseControlCount: closeButtons,
    fixturePluginsAbsent: fixtures.every((id) => !app.plugins.plugins[id]),
  };
})()

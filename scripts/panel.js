(async () => {
  app.commands.executeCommandById("nomad-transcripts:open");
  await new Promise((r) => setTimeout(r, 1000));
  return {
    panelOpen: !!document.querySelector(".modal"),
    text: document.querySelector(".modal")?.innerText,
  };
})();

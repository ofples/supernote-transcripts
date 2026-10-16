(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  const result = { text: root?.innerText, buttons: [...(root?.querySelectorAll("button") || [])].map((b) => ({ text: b.textContent.trim(), aria: b.getAttribute("aria-label"), title: b.title, cls: b.className })), summaries: [...(root?.querySelectorAll("summary") || [])].map((s) => s.textContent.trim()) };
  require("fs").writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/probe.json", JSON.stringify(result, null, 2));
  return result;
})();

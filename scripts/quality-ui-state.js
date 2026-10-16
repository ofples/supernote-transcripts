(() => globalThis.__qualityUIState = ({
  form: !!document.querySelector(".st-fullscreen-modal"),
  buttons: [...(document.querySelector(".st-fullscreen-modal")?.querySelectorAll("button") || [])].map((button) => button.textContent.trim()),
  summaries: [...(document.querySelector(".st-fullscreen-modal")?.querySelectorAll("summary") || [])].map((summary) => summary.textContent.trim()),
  screen: document.querySelector(".st-fullscreen-modal")?.innerText.slice(0, 180),
}))();

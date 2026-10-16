(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  return {
    rootPresent: !!root,
    buttons: root ? [...root.querySelectorAll("button")].map((button) => ({
      text: button.textContent.trim().slice(0, 48),
      aria: button.getAttribute("aria-label"),
      title: button.getAttribute("title"),
      key: button.dataset.queueKey ?? null,
      notebook: button.dataset.notebookId ? button.dataset.notebookId.split("/").pop() : null,
      className: typeof button.className === "string" ? button.className : "",
    })) : [],
  };
})()

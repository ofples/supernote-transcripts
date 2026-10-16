(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  return {
    recoveryPresent: !!root?.querySelector(".st-recovery"),
    recoveryActionContainers: root?.querySelectorAll(".st-recovery-actions").length ?? 0,
    actionContainers: root ? [...root.querySelectorAll(".st-actions")].map((container) => ({
      buttons: [...container.querySelectorAll("button")].map((button) => ({
        disabled: button.disabled,
        className: typeof button.className === "string" ? button.className : "",
      })),
    })) : [],
  };
})()

(() => {
  const fixture = window.__qualityUIFixture;
  const waitFor = async (predicate) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 30)); } throw Error("Timed out waiting for UI state"); };
  const root = () => document.querySelector(".st-fullscreen-modal");
  const button = (label) => [...(root()?.querySelectorAll("button") || [])].find((item) => item.textContent.trim() === label);
  const editor = () => root()?.querySelector('.st-quality-field input[type="range"]');
  const setQuality = (value) => { const slider = editor(); if (!slider) throw Error("Quality slider not found in source editor"); slider.value = String(value); slider.dispatchEvent(new Event("input", { bubbles: true })); return { value: slider.value, label: slider.getAttribute("aria-valuetext"), summary: root().querySelector(".st-quality-summary")?.textContent }; };
  const openEditor = async () => { root()?.querySelector('[aria-label="Configure Demo"]')?.click(); await waitFor(() => !!editor()); };
  const closeEditor = async (label) => { button(label)?.click(); await waitFor(() => !editor()); };
  const record = { state: "running" };
  globalThis.__qualityUIInteractions = record;
  void (async () => {
    try {
      if (!fixture || !root()?.querySelector('[aria-label="Configure Demo"]')) throw Error("Fresh Mirrors panel missing");
      await openEditor();
      const initial = { value: editor().value, label: editor().getAttribute("aria-valuetext") };
      setQuality(0);
      await closeEditor("Cancel");
      const afterCancel = { profileQuality: fixture.config.profiles.find((p) => p.id === "fixture-careful")?.quality, ruleProfileId: fixture.config.rules[0].profileId };
      record.results = { initial, afterCancel };

      await openEditor();
      const reopenAfterCancel = { value: editor().value, label: editor().getAttribute("aria-valuetext") };
      const savedBalancedDraft = setQuality(1);
      button("Save")?.click(); await waitFor(() => !editor());
      const afterBalancedSave = { profileQuality: fixture.config.profiles.find((p) => p.id === fixture.config.rules[0].profileId)?.quality, ruleProfileId: fixture.config.rules[0].profileId, saveCalls: fixture.saveCalls };
      Object.assign(record.results, { reopenAfterCancel, savedBalancedDraft, afterBalancedSave });

      await openEditor();
      const reopenAfterSave = { value: editor().value, label: editor().getAttribute("aria-valuetext") };
      setQuality(2); button("Save")?.click(); await waitFor(() => !editor());
      await openEditor();
      [...root().querySelectorAll("summary")].find((item) => item.textContent.trim() === "Source options")?.click();
      const resetButton = button("Reset transcription settings"); if (!resetButton) throw Error("Reset control missing");
      resetButton.click();
      const resetDraft = { value: editor().value, label: editor().getAttribute("aria-valuetext"), summary: root().querySelector(".st-quality-summary")?.textContent };
      button("Save")?.click(); await waitFor(() => !editor());
      const afterResetSave = { profileQuality: fixture.config.profiles.find((p) => p.id === fixture.config.rules[0].profileId)?.quality, ruleProfileId: fixture.config.rules[0].profileId, saveCalls: fixture.saveCalls };
      Object.assign(record.results, { reopenAfterSave, resetDraft, afterResetSave });

      fixture.provider = "api";
      root().querySelector('[aria-label="Costs"]')?.click();
      await waitFor(() => !!root()?.querySelector(".st-cost-settings"));
      const costDetails = [...root().querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent.trim() === "Limits and model pricing");
      if (!costDetails) throw Error("Cost settings details missing"); costDetails.open = true;
      const costText = costDetails.innerText;
      Object.assign(record.results, { costDetails: costText, costLabel: costText.includes("Output allowance per page"), costOldLabelAbsent: !costText.includes("Maximum output tokens"), groupedAllowanceExplained: costText.includes("Grouped requests multiply this allowance") });
      root().querySelector('[aria-label="Back"]')?.click(); await waitFor(() => !!root()?.querySelector('[aria-label="Configure Demo"]'));
      fixture.provider = "subscription";
      root().querySelector('[aria-label="Costs"]')?.click();
      await waitFor(() => !!root()?.querySelector(".st-subscription-breakdown"));
      const usage = root().querySelector(".st-subscription-breakdown");
      if (!usage) throw Error("Subscription usage breakdown missing"); usage.open = true;
      const usageText = usage.innerText;
      record.state = "complete";
      Object.assign(record.results, { usage: usageText, byNote: usageText.includes("By note"), byModel: usageText.includes("By model"), demoNote: usageText.includes("Demo.note"), journalNote: usageText.includes("Journal.note"), models: usageText.includes("GPT-6.1 Sol") && usageText.includes("GPT-5.6 Sol"), summary: root().querySelector(".st-summary-title")?.textContent });
      require("fs").writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/interactions.json", JSON.stringify(record, null, 2));
    } catch (error) {
      record.state = "failed"; record.error = String(error?.message || error?.name || "Error");
      require("fs").writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/interactions.json", JSON.stringify(record, null, 2));
    }
  })();
})();

import { resolveFormatting } from "./prompts.mjs";
import { validateDestination } from "./reconcile.mjs";
import { validPromptReference } from "./prompt-library.mjs";

/**
 * Copy the profile and resolve inherited settings before a scoped job is saved.
 * @param {import("./types").Profile[]} profiles
 * @param {string} id
 */
export function snapshotRecognitionProfile(profiles, id) {
  const profile = profiles.find(item => item.id === id);
  if (!profile) throw Error("Transcription profile was removed.");
  const formatting = resolveFormatting(profile, profiles.find(item => item.id === "general") ?? profiles[0]);
  return {
    ...profile, glossaries: [...profile.glossaries],
    preserveFormatting: formatting.enabled, formattingGuide: formatting.guide,
  };
}

const bounded = (value, maximum) => typeof value === "string" && !!value.trim() && value.length <= maximum;
const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
const referencePath = value => {
  try { return typeof value === "string" && validateDestination(value) === value; }
  catch { return false; }
};

/** @param {any} value @returns {value is import("./types").RecognitionRun} */
export function validRecognitionRun(value) {
  if (!isRecord(value) || !isRecord(value.profile) ||
      (value.prompt !== undefined && !validPromptReference(value.prompt))) return false;
  const profile = value.profile;
  return bounded(profile.id, 200) && bounded(profile.name, 200) &&
    bounded(profile.model, 200) && bounded(profile.endpoint, 8000) &&
    typeof profile.prompt === "string" && profile.prompt.length <= 20000 &&
    Array.isArray(profile.glossaries) && profile.glossaries.every(referencePath) &&
    (profile.quality === undefined || ["fast", "balanced", "careful"].includes(profile.quality)) &&
    typeof profile.preserveFormatting === "boolean" &&
    typeof profile.formattingGuide === "string" && profile.formattingGuide.length <= 20000;
}

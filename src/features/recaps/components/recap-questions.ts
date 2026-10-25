import { useTemplates } from "@/features/templates/api";
import { DEFAULT_QUESTIONS, parseQuestions } from "../model";

/** Leitfragen für einen neuen Rückblick: Vorlage „Rückblick“ (B11), sonst die eingebauten. */
export function useRecapQuestions() {
  const templates = useTemplates();
  const template = templates.data?.find((t) => t.kind === "rueckblick");
  const questions = template ? parseQuestions(template.body) : [];
  return questions.length > 0 ? questions : DEFAULT_QUESTIONS;
}

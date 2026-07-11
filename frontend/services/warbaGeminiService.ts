/**
 * @deprecated This module is a thin backward-compatible wrapper around the
 * unified `geminiService.ts`. New code should import directly from there.
 *
 * It exists so that existing call sites that do:
 *   import { extractTransactionsFromText } from "../services/warbaGeminiService";
 * continue to work unchanged.
 */
import { ExtractedData } from "../types";
import {
  extractTransactionsFromText as extractTransactionsFromTextImpl,
  WARBA_GEMINI_PROFILE,
} from "./geminiService";

export async function extractTransactionsFromText(
  text: string,
): Promise<ExtractedData> {
  return extractTransactionsFromTextImpl(text, WARBA_GEMINI_PROFILE);
}
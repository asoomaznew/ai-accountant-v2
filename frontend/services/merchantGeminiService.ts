import { ExtractedData } from "../types";
import {
  extractTransactionsFromText as extractTransactionsFromTextImpl,
  MERCHANT_GEMINI_PROFILE,
} from "./geminiService";

/**
 * Backward-compatibility wrapper for the merchant (Clover) bank statement extractor.
 *
 * The actual implementation now lives in `geminiService.ts` and is shared with
 * `warbaGeminiService.ts` via a profile-based design.
 *
 * Existing call sites can keep importing `extractTransactionsFromText` from this
 * module unchanged.
 */
export async function extractTransactionsFromText(
  text: string,
): Promise<ExtractedData> {
  return extractTransactionsFromTextImpl(text, MERCHANT_GEMINI_PROFILE);
}
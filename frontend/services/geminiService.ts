/**
 * Unified Gemini extraction service.
 *
 * This module consolidates the previously duplicated `warbaGeminiService.ts`
 * and `merchantGeminiService.ts`. Both files were 95% identical; the only
 * differences were (a) the entity name mentioned in the prompt and (b) a few
 * wording nuances in the prompt and error messages.
 *
 * Backward-compat wrappers in `warbaGeminiService.ts` and
 * `merchantGeminiService.ts` re-export `extractTransactionsFromText` with a
 * bank-specific profile.
 */
import { Type } from "@google/genai";
import { generateContentWithRetry, checkApiKeyForGemini } from "./llmGateway";
import { ExtractedData } from "../types";

/** Per-bank wording that varies between Warba and Merchant/Clover prompts. */
export interface GeminiBankProfile {
  /** Schema-level description for `accountName`. */
  accountNameSchemaDescription: string;
  /** Schema-level description for `accountNumber`. */
  accountNumberSchemaDescription: string;
  /**
   * Inline hint shown in prompt step 1, e.g.:
   *   - Warba:   `It should be "Warba Medical Polyclinic".`
   *   - Merchant: `e.g., "YARROW POLYCLINIC".`
   */
  step1Hint: string;
  /**
   * Inline hint shown in prompt step 2, e.g.:
   *   - Warba:   `` (empty)
   *   - Merchant: `(e.g., "KIBXX-1234" or "011010198602")`
   */
  step2Hint: string;
  /**
   * Extra credit-direction keywords mentioned in prompt step 4, e.g.
   *   - Warba:   []  (no extra examples)
   *   - Merchant: ["PURCHASE", "WITHDRAWAL", "FEE", "PAYMENT", "PMT", "CHARGE", "DEPOSIT", "TRANSFER FROM"]
   */
  step4CreditExamples: string[];
  /** Error shown when AI returns the literal string "undefined". */
  emptyResponseError: string;
  /** Error shown when the parsed JSON is missing required fields. */
  missingFieldsError: string;
}

function buildResponseSchema(profile: GeminiBankProfile) {
  return {
    type: Type.OBJECT,
    properties: {
      accountName: {
        type: Type.STRING,
        description: profile.accountNameSchemaDescription,
      },
      accountNumber: {
        type: Type.STRING,
        description: profile.accountNumberSchemaDescription,
      },
      transactions: {
        type: Type.ARRAY,
        description:
          "A list of all credit transactions (deposits) and debit transactions (withdrawals, payments).",
        items: {
          type: Type.OBJECT,
          properties: {
            date: {
              type: Type.STRING,
              description: "Transaction date in YYYY-MM-DD format.",
            },
            description: {
              type: Type.STRING,
              description: "The full, original transaction description.",
            },
            amount: {
              type: Type.NUMBER,
              description: "The numeric transaction amount.",
            },
            type: {
              type: Type.STRING,
              description:
                "The type of transaction, must be either 'credit' or 'debit'.",
              enum: ["credit", "debit"],
            },
          },
          required: ["date", "description", "amount", "type"],
        },
      },
    },
    required: ["accountName", "accountNumber", "transactions"],
  };
}

function buildPrompt(profile: GeminiBankProfile, truncatedText: string): string {
  const step4Examples = profile.step4CreditExamples.length
    ? ` For example, '${profile.step4CreditExamples.join("', '")}' keywords usually indicate direction.`
    : "";

  return `
    You are an expert financial data extraction API.
    Analyze the following bank statement text. Your task is to:
    1. Identify the primary account holder's name (${profile.step1Hint}).
    2. Identify the bank Account Number for the statement${profile.step2Hint}.
    3. Extract ALL transactions, both CREDIT (deposits, incoming funds) and DEBIT (withdrawals, payments made, fees). DO NOT MISS OR SKIP A SINGLE TRANSACTION.
    4. For each transaction, you must identify its type as either 'credit' or 'debit'.${step4Examples}
    5. The amount must always be a positive absolute number. Do not return negative amounts; use the transaction type field to indicate direction.
    6. Format the extracted data into a JSON object that strictly follows the provided schema.
    7. Ensure dates are standardized to YYYY-MM-DD format if possible. If year is ambiguous, assume the current year.

    CRITICAL INSTRUCTION: You must extract every single transaction from the text. Missing even one transaction is a catastrophic failure. Take your time and output all of them.

    Bank Statement Text:
    ---
    ${truncatedText}
    ---
  `;
}

/**
 * Extract transactions from raw bank-statement text using Gemini.
 *
 * The function is the single source of truth for prompt construction, JSON
 * cleaning, validation, and error handling. Both the Warba and Merchant
 * services are thin wrappers around it.
 */
export async function extractTransactionsFromText(
  text: string,
  profile: GeminiBankProfile,
): Promise<ExtractedData> {
  checkApiKeyForGemini();

  const truncatedText = text.substring(0, 100000);
  const prompt = buildPrompt(profile, truncatedText);
  const responseSchema = buildResponseSchema(profile);

  // ── Determine which models to try ────────────────────────────────────────
  // For Gemini: try multiple fallback models automatically.
  // For Ollama / WebLLM: only one model exists (haitham-accountant:latest etc.)
  //   so we just call once — no point retrying the same model three times.
  const { getLLMConfig } = await import("./localLlmService");
  const llmConfig = getLLMConfig();
  const isGemini = llmConfig.provider === "gemini";

  const MODEL_CHAIN = isGemini
    ? ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
    : ["local"]; // placeholder — generateContentWithRetry routes to Ollama/WebLLM automatically

  let lastError: Error = new Error("All models failed.");

  for (const model of MODEL_CHAIN) {
    try {
      console.log(`[extractTransactions] Trying: ${isGemini ? model : llmConfig.ollamaModel || "local LLM"}`);

      const response = await generateContentWithRetry({
        model: isGemini ? model : "gemini-2.5-flash", // model name ignored for local LLM
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          maxOutputTokens: 8192,
        },
      });

      const rawText = response.text?.trim();
      if (!rawText) {
        lastError = new Error("The AI model returned an empty response.");
        if (!isGemini) break; // no fallback available for local LLM
        continue;
      }

      // ── Parse JSON ─────────────────────────────────────────────────────
      let parsedData: unknown;
      try {
        const cleanedJsonText = rawText
          .replace(/^```json\s*/, "")
          .replace(/\s*```$/, "");
        parsedData = JSON.parse(cleanedJsonText);
      } catch (e) {
        console.warn(`[extractTransactions] Unparseable JSON from ${model}:`, rawText);
        lastError = new Error("The AI returned data in an unexpected format.");
        if (!isGemini) break;
        continue;
      }

      // ── Normalize the response ──────────────────────────────────────────
      let normalizedData: Record<string, unknown>;

      if (Array.isArray(parsedData)) {
        // Edge case: bare array of transactions
        normalizedData = { accountName: "", accountNumber: "", transactions: parsedData };
      } else {
        const d = parsedData as Record<string, unknown>;

        // Detect the "schema-echo" bug: model returns the schema wrapper instead of data
        // Pattern: { type: "object", properties: { accountName: {...}, transactions: [...] } }
        const isSchemaEcho =
          d.type === "object" &&
          d.properties !== null &&
          typeof d.properties === "object" &&
          !Array.isArray(d.properties);

        if (isSchemaEcho) {
          console.warn(`[extractTransactions] schema-echo detected — unwrapping from properties…`);
          const props = d.properties as Record<string, unknown>;
          normalizedData = {
            accountName:
              (props.accountName as any)?.default ??
              (props.accountName as any)?.value ??
              "",
            accountNumber:
              (props.accountNumber as any)?.default ??
              (props.accountNumber as any)?.value ??
              "",
            transactions: Array.isArray(props.transactions) ? props.transactions : [],
          };
        } else {
          // Normal path
          if (!("accountName" in d)) d.accountName = (d as any).account_name ?? "";
          if (!("accountNumber" in d)) d.accountNumber = (d as any).account_number ?? "";
          if (!("transactions" in d) || !Array.isArray(d.transactions)) d.transactions = [];
          normalizedData = d;
        }
      }

      // ── Validate ────────────────────────────────────────────────────────
      if (
        !normalizedData ||
        typeof normalizedData !== "object" ||
        !("accountName" in normalizedData) ||
        !("accountNumber" in normalizedData) ||
        !Array.isArray(normalizedData.transactions)
      ) {
        const keys = Object.keys(normalizedData ?? {}).join(", ");
        console.warn(`[extractTransactions] Incomplete structure (keys: ${keys})`);
        lastError = new Error(`${profile.missingFieldsError} (Found keys: ${keys})`);
        if (!isGemini) break;
        continue;
      }

      if ((normalizedData.transactions as unknown[]).length === 0) {
        console.warn(`[extractTransactions] 0 transactions returned.`);
        lastError = new Error("The AI found no transactions in this document.");
        if (!isGemini) break; // no fallback for local LLM — just surface the error
        continue;
      }

      // ── Success ─────────────────────────────────────────────────────────
      console.log(`[extractTransactions] ✅ ${(normalizedData.transactions as unknown[]).length} transactions extracted.`);
      return normalizedData as unknown as ExtractedData;

    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.warn(`[extractTransactions] Error from ${model}: ${msg}`);
      lastError = error instanceof Error ? error : new Error(msg);

      // Don't fall back on auth/key errors
      if (
        msg.includes("API key") ||
        msg.includes("PERMISSION_DENIED") ||
        msg.includes("__RULES_ENGINE_UNSUPPORTED__")
      ) {
        break;
      }
      if (!isGemini) break; // no further fallbacks for local LLM
    }
  }

  throw new Error(`Gemini API Error: ${lastError.message}`);
}

// --- Pre-built profiles for the two supported banks ---

export const WARBA_GEMINI_PROFILE: GeminiBankProfile = {
  accountNameSchemaDescription:
    "The primary account holder's name or company name found in the statement. It should be 'Warba Medical Polyclinic'.",
  accountNumberSchemaDescription:
    "The bank account number found in the statement. This can be a long numeric string or a shorter alphanumeric identifier. Extract whichever is present.",
  step1Hint: 'It should be "Warba Medical Polyclinic"',
  step2Hint: "",
  step4CreditExamples: [],
  emptyResponseError: "The AI failed to extract data.",
  missingFieldsError: "AI response is missing required fields.",
};

export const MERCHANT_GEMINI_PROFILE: GeminiBankProfile = {
  accountNameSchemaDescription:
    "The primary account holder's name or company name found in the statement.",
  accountNumberSchemaDescription:
    "The bank account number found in the statement. This can be a long numeric string or a shorter alphanumeric identifier (e.g., 'KIBXX-1234'). Extract whichever is present.",
  step1Hint: 'e.g., "YARROW POLYCLINIC"',
  step2Hint: ' (e.g., "KIBXX-1234" or "011010198602")',
  step4CreditExamples: [
    "PURCHASE",
    "WITHDRAWAL",
    "FEE",
    "PAYMENT",
    "PMT",
    "CHARGE",
    "DEPOSIT",
    "TRANSFER FROM",
  ],
  emptyResponseError:
    "The AI failed to extract data. Document may be invalid or contains no transactions.",
  missingFieldsError: "AI response is missing required data fields.",
};

export async function getAiName(text: string, instructions: string): Promise<string | null> {
  checkApiKeyForGemini();

  const model = "gemini-2.5-flash";
  const truncatedText = text.substring(0, 100000);

  const prompt = `
    ${instructions}
    
    Analyze the following document text and extract only the identifier based on the instructions.
    The output should be a single, clean string suitable for a file name. Do not include any explanation, context, or file extension.

    Document Text:
    ---
    ${truncatedText}
    ---
  `;

  try {
    const response = await generateContentWithRetry({
      model: model,
      contents: prompt,
    });
    
    const resultText = response.text;

    if (resultText) {
      return resultText.trim().replace(/\.[^/.]+$/, '');
    }
    
    return null;
  } catch (error) {
    console.error("Gemini AI extraction error:", error);
    if (error instanceof Error) {
        if (error.message === "__RULES_ENGINE_UNSUPPORTED__") {
            throw new Error("Python Rules Engine does not support this AI tool. Please select Gemini, Ollama, or WebLLM in Settings.");
        }
        throw new Error(`Gemini API Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the Gemini API.");
  }
}

export async function getMedicalStatementFilename(text: string): Promise<string | null> {
  checkApiKeyForGemini();

  const model = "gemini-2.5-flash";

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "The patient or clinic name. If the name contains the word 'Clinic', it must be removed.",
      },
      accountNumber: {
        type: Type.STRING,
        description: "The full account number.",
      },
      toDate: {
        type: Type.STRING,
        description: "The end date of the statement period, formatted as DD-MMM (e.g., 20-Jul). The year must be omitted.",
      },
    },
    required: ["name", "accountNumber", "toDate"],
  };

  const prompt = `
    From the provided medical statement text, extract three specific pieces of information:
    1.  **Name**: Find the primary name on the statement. If this name includes the word "Clinic", you must remove "Clinic" from the output.
    2.  **Account Number**: Extract the complete account number.
    3.  **To Date**: Identify the end date of the statement period. Format this date as DD-MMM (example: 20-Jul), ensuring the year is excluded.
    
    Return these details in a JSON object.

    Document Text:
    ---
    ${text}
    ---
  `;

  try {
    const response = await generateContentWithRetry({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    const jsonString = response.text?.trim();
    if (!jsonString) {
      return null;
    }

    const parsed = JSON.parse(jsonString);
    const { name, accountNumber, toDate } = parsed;

    if (!name || !accountNumber || !toDate) {
      return null;
    }

    const last4 = accountNumber.slice(-4);
    const filename = `${name}-${last4}-${toDate}`;

    return filename;

  } catch (error) {
    console.error("Gemini AI medical statement extraction error:", error);
    if (error instanceof Error) {
        if (error.message === "__RULES_ENGINE_UNSUPPORTED__") {
            throw new Error("Python Rules Engine does not support this AI tool. Please select Gemini, Ollama, or WebLLM in Settings.");
        }
        throw new Error(`Gemini API Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the Gemini API.");
  }
}

export async function getShortenedSuffix(suffixText: string): Promise<string> {
    checkApiKeyForGemini();
    if (!suffixText.trim()) {
        return "";
    }

    const model = "gemini-2.5-flash";
    const prompt = `
      You are an expert in formatting date ranges for filenames.
      Convert the following text into a specific, readable date range format, omitting the year.
      
      The target format is "DD-Mon to DD Month". 
      - The start date should be "DD-Mon" (e.g., "01-Jul"). Use a leading zero for the day.
      - The end date should be "DD Month" (e.g., "20 July"). Use a space between the day and the full month name.
      - Use " to " as the separator between the start and end dates.
      - Always omit the year, even if it is present in the input.

      Example Input: "from 1-July to 20-july-2025"
      Example Output: "01-Jul to 20 July"
      
      Example Input: "Meeting from 5th of Aug 2024 to 10th of Aug 2024"
      Example Output: "05-Aug to 10 August"

      Provide ONLY the formatted string in your response. Do not include any explanation.

      Original Text to convert: "${suffixText}"
    `;

    try {
        const response = await generateContentWithRetry({
            model: model,
            contents: prompt,
        });

        const resultText = response.text;
        return resultText ? resultText.trim() : suffixText; 
    } catch (error) {
        console.error("Gemini AI suffix shortening error:", error);
        return suffixText;
    }
}

export async function getAnswerFromText(pagesText: { pageNum: number; text: string }[], question: string): Promise<{ answer: string; pages: number[] }> {
  checkApiKeyForGemini();

  const formattedPages = pagesText.map(p => `Page ${p.pageNum}:\n${p.text}`).join('\n---\n');
  const maxChars = 300000;
  const truncatedText = formattedPages.length > maxChars ? formattedPages.substring(0, maxChars) + "\n... (document truncated)" : formattedPages;

  const prompt = `
    You are an expert document analysis assistant.
    Carefully read the provided document text, which includes page numbers.
    Answer the user's question based *only* on the information within the text.
    Your answer should be concise and directly address the question.
    After your answer, you MUST include a list of the page numbers that contain the relevant information, in the format [p. 1, 5, 10].
    If the answer cannot be found in the document, you MUST respond with "I could not find an answer to that question in the document." and do not provide any page numbers.

    User's Question: "${question}"

    Document Text:
    ---
    ${truncatedText}
    ---
  `;

  try {
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    
    const resultText = response.text?.trim();
    if (!resultText) {
      return { answer: "I could not find an answer to that question in the document.", pages: [] };
    }
    
    const pageMatch = resultText.match(/\[p\.\s*([\d,\s]+)\]\s*$/);
    let answer = resultText;
    let pages: number[] = [];

    if (pageMatch && pageMatch[1]) {
      answer = resultText.substring(0, pageMatch.index).trim();
      pages = pageMatch[1].split(',').map((p: string) => parseInt(p.trim(), 10)).filter((p: number) => !isNaN(p));
    }

    return { answer, pages };

  } catch (error) {
    console.error("Gemini AI Q&A error:", error);
    if (error instanceof Error) {
        if (error.message === "__RULES_ENGINE_UNSUPPORTED__") {
            throw new Error("Python Rules Engine does not support this AI tool. Please select Gemini, Ollama, or WebLLM in Settings.");
        }
        throw new Error(`Gemini API Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the AI.");
  }
}
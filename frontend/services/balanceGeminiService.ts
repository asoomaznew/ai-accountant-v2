import { Type } from "@google/genai";
import { generateContentWithRetry, checkApiKeyForGemini } from "./llmGateway";

export const getEndingBalanceFromText = async (
  text: string,
): Promise<{
  corporateName: string;
  accountNumber: string;
  endBalance: string;
  documentType: 'statement' | 'reconciliation' | 'unknown';
} | null> => {
  checkApiKeyForGemini();

  const model = "gemini-2.5-flash";

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      corporateName: {
        type: Type.STRING,
        description:
          "The corporate name, account holder's name, or company name.",
      },
      accountNumber: {
        type: Type.STRING,
        description: "The full account number. E.g., '011010232380' or 'KIBAA-2380'.",
      },
      endBalance: {
        type: Type.STRING,
        description:
          "The ending balance, closing balance, statement balance, book balance, or balance after the last transaction. E.g. '150,000.00'",
      },
      documentType: {
        type: Type.STRING,
        description: "The type of document: 'statement' if it's a bank statement, 'reconciliation' if it's a bank reconciliation form/document, or 'unknown'.",
      }
    },
    required: ["corporateName", "accountNumber", "endBalance", "documentType"],
  };

  const truncatedText = text.substring(0, 150000);

  const prompt = `
    Analyze the following document text and extract four pieces of information:
    1.  **Corporate Name**: The company name, account name, or corporate name.
    2.  **Account Number**: The complete bank account number. (Often formatted like '0110xxxxxxxx' or a mapped name like 'KIBAA-2380'). If you see patterns like that, pull them exactly.
    3.  **End Balance**: The final ending balance, closing balance, or the balance for the bank/book reconciliation.
    4.  **Document Type**: Is this a Bank Statement ('statement') or a Bank Reconciliation ('reconciliation')?

    Return these details in a JSON object.

    Document Text:
    ---
    ${truncatedText}
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

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      console.error("Failed to parse ending balance json response:", jsonString, e);
      throw new Error("The AI returned data in an unexpected format.");
    }
    const { corporateName, accountNumber, endBalance, documentType } = parsed;

    if (!corporateName || !accountNumber) {
      return null;
    }

    return { corporateName, accountNumber, endBalance: endBalance || '0.00', documentType: documentType || 'unknown' };
  } catch (error) {
    console.error("Gemini AI ending balance extraction error:", error);
    if (error instanceof Error) {
      throw new Error(`Gemini API Error: ${error.message}`);
    }
    throw new Error(
      "An unknown error occurred while communicating with the Gemini API.",
    );
  }
};

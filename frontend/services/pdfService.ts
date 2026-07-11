
import * as pdfjsLib from 'pdfjs-dist';
import { wrap, type Remote } from 'comlink';
import type { pdfWorker as PdfWorkerType } from '../workers/pdf.worker';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

let pdfWorkerInstance: Worker | null = null;
let pdfWorkerAPI: Remote<typeof PdfWorkerType> | null = null;

export const getPdfWorkerAPI = (): Remote<typeof PdfWorkerType> => {
  if (!pdfWorkerAPI && typeof window !== 'undefined') {
    pdfWorkerInstance = new Worker(
      new URL('../workers/pdf.worker', import.meta.url),
      { type: 'module' }
    );
    pdfWorkerAPI = wrap<typeof PdfWorkerType>(pdfWorkerInstance);
  }
  if (!pdfWorkerAPI) throw new Error('PDF Web Worker unavailable');
  return pdfWorkerAPI;
};

export const extractTextFromImage = async (file: File, lang: string = 'eng+ara'): Promise<string> => {
  const imageUrl = URL.createObjectURL(file);
  try {
    const api = getPdfWorkerAPI();
    const text = await api.extractTextFromImage(imageUrl, lang);
    return text;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export const extractTextWithMuPdf = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const api = getPdfWorkerAPI();
  return await api.readPdfWithMuPdf(arrayBuffer);
};

export const extractTextFromPdf = async (file: File): Promise<string> => {
  const pages = await extractTextFromPdfWithPageNumbers(file);
  return pages.map(p => p.text).join("\n");
};

export interface PageText {
  pageNum: number;
  text: string;
}

export const extractTextFromPdfWithPageNumbers = async (file: File): Promise<PageText[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const typedarray = new Uint8Array(arrayBuffer.slice(0));
    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    
    // Parallelize page processing using Promise.all
    const pagePromises = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        pagePromises.push(pdf.getPage(i).then(async page => {
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => 'str' in item ? item.str : '').join(" ");
            return { pageNum: i, text: pageText };
        }));
    }
    
    return await Promise.all(pagePromises);
  } catch (error) {
    if (error instanceof Error) {
        throw new Error(`PDF processing error: ${error.message}`);
    } else {
        throw new Error("An unknown error occurred during PDF processing.");
    }
  }
};

export interface KeywordSearchResult {
  [keyword: string]: number[]; // page numbers are 1-based
}

export const searchKeywordsInPdf = async (file: File, keywords: string[]): Promise<KeywordSearchResult> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const typedarray = new Uint8Array(arrayBuffer.slice(0));
    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    
    const results: KeywordSearchResult = {};
    keywords.forEach(kw => results[kw] = []);

    const lowerCaseKeywords = keywords.map(k => k.toLowerCase());

    // Process pages in parallel
    const pagePromises = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        pagePromises.push(pdf.getPage(i).then(async page => {
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => 'str' in item ? item.str : '').join(" ");
            const pageTextLower = pageText.toLowerCase();
            return { pageNum: i, textLower: pageTextLower };
        }));
    }

    const pages = await Promise.all(pagePromises);

    pages.forEach(({ pageNum, textLower }) => {
        lowerCaseKeywords.forEach((keyword, index) => {
            if (textLower.includes(keyword)) {
                results[keywords[index]].push(pageNum);
            }
        });
    });

    return results;
  } catch (error) {
    if (error instanceof Error) {
        throw new Error(`PDF processing error: ${error.message}`);
    } else {
        throw new Error("An unknown error occurred during PDF processing.");
    }
  }
};

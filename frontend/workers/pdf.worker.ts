import { expose } from 'comlink';
import Tesseract from 'tesseract.js';
import * as mupdf from 'mupdf';

export const pdfWorker = {
  async extractTextFromImage(imageUrl: string, lang: string = 'eng+ara') {
    const worker = await Tesseract.createWorker(lang);
    const { data: { text } } = await worker.recognize(imageUrl);
    await worker.terminate();
    return text;
  },

  async readPdfWithMuPdf(arrayBuffer: ArrayBuffer) {
    // Basic MuPDF read implementation
    try {
      const doc = mupdf.Document.openDocument(arrayBuffer, "application/pdf");
      let text = "";
      const count = doc.countPages();
      for (let i = 0; i < count; i++) {
          const page = doc.loadPage(i);
          text += page.toStructuredText().asText() + "\n";
      }
      return text;
    } catch (e) {
      console.error("MuPDF failed", e);
      return "";
    }
  }
};

expose(pdfWorker);

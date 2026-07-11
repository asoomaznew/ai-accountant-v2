import * as XLSX from 'xlsx';

export const extractTextFromExcel = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        let fullText = "";

        workbook.SheetNames.forEach((sheetName: string) => {
            const sheet = workbook.Sheets[sheetName];
            const sheetText = XLSX.utils.sheet_to_csv(sheet);
            fullText += sheetText + "\n";
        });
        
        return fullText;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Excel processing error: ${error.message}`);
        } else {
            throw new Error("An unknown error occurred during Excel processing.");
        }
    }
};

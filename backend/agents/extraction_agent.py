import os
import re
import logging
import pdfplumber
import pandas as pd
from typing import Dict, Any

logger = logging.getLogger(__name__)

class ExtractionAgent:
    """
    Agent responsible for extracting raw text or data tables from uploaded files.
    No LLM calls are made here.
    """
    def __init__(self):
        self._ACCOUNT_PATTERN = re.compile(
            r"(?:Account\s*Number|A/C\s*No\.?|Account)\s*[:\-]?\s*([\w\d\-]+)",
            re.IGNORECASE,
        )

    def extract_text_and_tables(self, file_path: str, filename: str) -> Dict[str, Any]:
        filename_lower = filename.lower()
        account_number = "N/A"
        raw_text = ""
        dataframes = {}

        if filename_lower.endswith(('.csv', '.xlsx', '.xls')):
            logger.info(f"ExtractionAgent: Parsing tabular file {filename}")
            try:
                if filename_lower.endswith('.csv'):
                    df = pd.read_csv(file_path)
                    dataframes['csv'] = df
                    raw_text = df.to_string(index=False)
                else:
                    xl = pd.ExcelFile(file_path)
                    sheet_texts = []
                    for sheet_name in xl.sheet_names:
                        df = pd.read_excel(file_path, sheet_name=sheet_name)
                        dataframes[sheet_name] = df
                        sheet_texts.append(f"--- Sheet: {sheet_name} ---\n" + df.to_string(index=False))
                    raw_text = "\n\n".join(sheet_texts)
            except Exception as e:
                logger.error(f"Error reading tabular data in ExtractionAgent: {e}")
                raw_text = ""
        else:
            logger.info(f"ExtractionAgent: Parsing PDF file {filename}")
            try:
                with pdfplumber.open(file_path) as pdf:
                    pages_text = []
                    for page in pdf.pages:
                        t = page.extract_text()
                        if t:
                            pages_text.append(t)
                    raw_text = "\n".join(pages_text)

                acc_match = self._ACCOUNT_PATTERN.search(raw_text)
                if acc_match:
                    account_number = acc_match.group(1)
            except Exception as e:
                logger.error(f"Error reading PDF in ExtractionAgent: {e}")
                raw_text = ""

        return {
            "text": raw_text,
            "dataframes": dataframes,
            "account_number": account_number,
            "filename": filename
        }


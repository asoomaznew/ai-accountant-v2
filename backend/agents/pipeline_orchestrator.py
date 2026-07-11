import logging
import os
import re
from typing import List, Dict, Any, Union

from .extraction_agent import ExtractionAgent
from .ai_parsing_agent import AIParsingAgent
from .cleansing_agent import CleansingAgent
from .accounting_agent import AccountingAgent
from .export_agent import ExportAgent

# Import existing modules for rules fallback
from modules.parser_module import parse_warba_statement
from .merchant_rules import extract_kib_aseel
from .smart_merchant_parser import SmartMerchantParser

logger = logging.getLogger(__name__)

class SupervisorAgent:
    """
    PipelineOrchestrator coordinating the 5 specialized agents:
    Extraction -> AI Parsing -> Cleansing -> Accounting -> Export
    """
    def __init__(self):
        self.extractor = ExtractionAgent()
        self.parser = AIParsingAgent()
        self.cleanser = CleansingAgent()
        self.accountant = AccountingAgent()
        self.exporter = ExportAgent()

    def _get_merchant_account_name(self, filename: str) -> str:
        filename_lower = filename.lower()
        if "aseel" in filename_lower:
            return "AL ASEEL INTERNATIONAL POLYCLINIC"
        elif "aram" in filename_lower:
            return "ARAM CLINIC"
        elif "yarrow" in filename_lower:
            return "YARROW POLYCLINIC"
        elif "fourth" in filename_lower:
            return "FOURTH CLINIC"
        elif "joya" in filename_lower:
            return "JOYA CLINIC"
        elif "med" in filename_lower:
            return "MED CLINIC"
        elif "iris" in filename_lower:
            return "IRIS CLINIC"
        elif "tri care" in filename_lower:
            return "TRI CARE CLINIC"
        else:
            return os.path.splitext(filename)[0].replace('_', ' ').replace('-', ' ').title()

    async def process_file_to_entries(self, file_path: str, filename: str, job_type: str = "bank", raw_only: bool = False) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
        logger.info(f"SupervisorAgent: Orchestrating pipeline for {filename} (job_type: {job_type}, raw_only: {raw_only})")
        
        # 1. Extraction Agent (Pure text & table parsing)
        extracted = self.extractor.extract_text_and_tables(file_path, filename)
        raw_text = extracted["text"]
        account_number = extracted["account_number"]
        
        parsed_data = {}
        
        # 2. AIParsing Agent / Local Parsing Engine
        if job_type == "merchant":
            logger.info("SupervisorAgent: Using Rules Engine for merchant job")
            account_name = self._get_merchant_account_name(filename)
            filename_lower = filename.lower()
            transactions = []
            
            is_kib = any(kib_name in filename_lower for kib_name in ["aseel", "iris", "fourth", "joya", "med", "yarrow", "aram", "tri care"])
            
            if filename_lower.endswith(('.csv', '.xlsx', '.xls')):
                logger.info("SupervisorAgent: Merchant file is tabular, using DataFrames.")
                parser = SmartMerchantParser()
                
                raw_txns = []
                dataframes = extracted.get("dataframes", {})
                if dataframes:
                    for sheet_name, df in dataframes.items():
                        txns = parser.extract_from_dataframe(df)
                        raw_txns.extend(txns)
                else:
                    raw_txns = parser.extract_from_text(raw_text)
                    
                for rt in raw_txns:
                    is_credit = rt.get("raw_credit") is not None
                    transactions.append({
                        "date": rt["raw_date"],
                        "description": rt["raw_desc"],
                        "amount": rt.get("raw_amount", "0"),
                        "type": "credit" if is_credit else "debit"
                    })
            elif is_kib and filename_lower.endswith('.pdf'):
                logger.info("SupervisorAgent: Using extract_kib_aseel")
                raw_txns = extract_kib_aseel(file_path)
                # Try to extract account number from raw text
                match = re.search(r'\n(\d{12})\b', raw_text)
                if match:
                    account_number = match.group(1)
                
                for rt in raw_txns:
                    is_credit = rt.get("raw_credit") is not None
                    transactions.append({
                        "date": rt["raw_date"],
                        "description": rt["raw_desc"],
                        "amount": rt["raw_amount"],
                        "type": "credit" if is_credit else "debit"
                    })
            else:
                logger.info("SupervisorAgent: Using SmartMerchantParser for PDF")
                parser = SmartMerchantParser()
                raw_txns = parser.extract_transactions(file_path)
                account_number = parser.account_number or account_number
                for rt in raw_txns:
                    is_credit = rt.get("raw_credit") is not None
                    transactions.append({
                        "date": rt["raw_date"],
                        "description": rt["raw_desc"],
                        "amount": rt.get("raw_amount", "0"),
                        "type": "credit" if is_credit else "debit"
                    })
            
            parsed_data = {
                "accountName": account_name,
                "accountNumber": account_number,
                "transactions": transactions
            }
        else:
            # For bank statements, we try to use LLM to parse accurately, falling back to local regex parser
            try:
                parsed_data = await self.parser.parse_transactions(
                    raw_text=raw_text,
                    account_name=os.path.splitext(filename)[0],
                    account_number=account_number
                )
            except Exception as e:
                logger.error(f"LLM parsing failed, falling back to local rules parser: {e}")
                parsed_data = parse_warba_statement(file_path, filename)

        # 3. Cleansing Agent (Sanitizing, currency symbols, float casting)
        cleansed_data = self.cleanser.cleanse_extracted_data(parsed_data)

        if raw_only:
            logger.info("SupervisorAgent: Returning raw cleansed data as requested")
            return cleansed_data

        # 4. Accounting Agent (Chart of accounts mapping, debit/credit logic)
        raw_journal_entries = self.accountant.generate_entries(cleansed_data, job_type=job_type)

        # 5. Export Agent (Rounding, formatting keys)
        final_entries = self.exporter.format_for_export(raw_journal_entries)

        return final_entries

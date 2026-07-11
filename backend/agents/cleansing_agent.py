import re
import logging
from typing import Dict, Any, List
from datetime import date
from dateutil import parser as date_parser
from pydantic import BaseModel, field_validator, ValidationError

logger = logging.getLogger(__name__)

class TransactionModel(BaseModel):
    date: str
    description: str
    amount: float
    type: str

    @field_validator('amount')
    def check_amount(cls, v):
        if v < 0:
            return abs(v)
        return v

    @field_validator('type')
    def check_type(cls, v):
        val = str(v).lower().strip()
        if val not in ["credit", "debit"]:
            return "debit"
        return val

class CleansingAgent:
    """
    Agent responsible for sanitizing the output of LLM parsing.
    Cleans date formats, standardizes numbers, removes symbols, and ensures type compliance.
    """
    def standardize_date(self, date_str: str) -> str:
        if not date_str:
            return date_str
        
        date_str = str(date_str).strip().replace(' ', '')
        
        # Fast check for standard format
        if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
            return date_str
            
        try:
            parsed = date_parser.parse(date_str, fuzzy=True, dayfirst=True)
            return parsed.strftime("%Y-%m-%d")
        except Exception:
            # Fallback
            match = re.match(r'^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', date_str)
            if match:
                day, month, year = match.groups()
                return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            return date_str

    def cleanse_extracted_data(self, parsed_data: Dict[str, Any]) -> Dict[str, Any]:
        logger.info("CleansingAgent: Cleaning and validating structured data with Pydantic")
        
        cleaned_transactions: List[Dict[str, Any]] = []
        raw_txns = parsed_data.get("transactions", [])
        
        for txn in raw_txns:
            date_val = txn.get("date", "")
            desc_val = txn.get("description", "")
            amt_val = txn.get("amount", 0.0)
            type_val = txn.get("type", "debit")
            
            # Pre-clean amount string before passing to Pydantic
            if isinstance(amt_val, str):
                amt_cleaned = amt_val.replace(',', '').replace('KD', '').replace('K.D.', '').strip()
                try:
                    amt = float(amt_cleaned)
                except ValueError:
                    amt = 0.0
            else:
                amt = float(amt_val or 0.0)
                
            std_date = self.standardize_date(date_val)
            
            try:
                # Validate with Pydantic
                valid_txn = TransactionModel(
                    date=std_date,
                    description=str(desc_val).strip() or "Unknown Transaction",
                    amount=amt,
                    type=type_val
                )
                
                # Exclude zero amount transactions to prevent empty ledger lines
                if valid_txn.amount > 0:
                    cleaned_transactions.append(valid_txn.model_dump())
                    
            except ValidationError as e:
                logger.warning(f"Dropping invalid transaction: {e}")
            
        return {
            "accountName": str(parsed_data.get("accountName", "Unknown")).strip(),
            "accountNumber": str(parsed_data.get("accountNumber", "N/A")).strip(),
            "transactions": cleaned_transactions
        }

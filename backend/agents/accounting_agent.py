import logging
from typing import Dict, Any, List, Tuple, Optional
from modules.accounting_module import generate_journal_entries
from modules.merchant_accounting import generate_merchant_journal_entries

logger = logging.getLogger(__name__)

class AccountingAgent:
    """
    Agent responsible for applying Chart of Accounts, debit/credit logic,
    and resolving bank account mappings to output IFRS-compliant journal entries.
    """
    def generate_entries(self, cleansed_data: Dict[str, Any], job_type: str = "bank") -> List[Dict[str, Any]]:
        logger.info(f"AccountingAgent: Generating journal entries based on chart of accounts (job_type: {job_type})")
        try:
            if job_type == "merchant":
                entries = generate_merchant_journal_entries(cleansed_data, is_pos=False)
            else:
                entries = generate_journal_entries(cleansed_data)
            return entries
        except Exception as e:
            logger.error(f"Error generating journal entries in AccountingAgent: {e}")
            return []

import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class ExportAgent:
    """
    Agent responsible for final formatting, ordering, and structuring
    of the journal entries list for API consumption or Excel exports.
    """
    def format_for_export(self, journal_entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        logger.info("ExportAgent: Formatting final output for export")
        formatted = []
        for entry in journal_entries:
            if entry.get("is_merchant_fully_formatted"):
                # Clean up the flag and return the fully structured merchant entry
                clean_entry = dict(entry)
                clean_entry.pop("is_merchant_fully_formatted", None)
                formatted.append(clean_entry)
                continue

            # Default bank statement formatting
            # Round amounts to 3 decimals (KD standard)
            amount = entry.get("amount", 0.0)
            if amount is not None:
                amount = round(float(amount), 3)

            formatted.append({
                "date": entry.get("date"),
                "accountNo": entry.get("accountNo"),
                "accountName": entry.get("accountName"),
                "debit": round(float(entry.get("debit")), 3) if entry.get("debit") is not None else None,
                "credit": round(float(entry.get("credit")), 3) if entry.get("credit") is not None else None,
                "description": entry.get("description"),
                "ref": entry.get("ref", ""),
                "activities": entry.get("activities", ""),
                "propertyId": entry.get("propertyId", "")
            })
        return formatted

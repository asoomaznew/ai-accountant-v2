import re
import pdfplumber
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

def extract_kib_aseel(file_path: str) -> List[Dict[str, Any]]:
    """
    Parses a KIB Aseel PDF statement to extract raw transaction details.
    """
    logger.info(f"extract_kib_aseel: Extracting from {file_path}")
    transactions = []
    
    start_date_pattern = re.compile(r'^(\d{1,2}-\d{1,2}-)')
    amount_pattern = re.compile(r'([\d,]+\.\d{3})')
    
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if not text:
                    continue
                
                lines = text.splitlines()
                i = 0
                while i < len(lines):
                    line = lines[i].strip()
                    date_match = start_date_pattern.search(line)
                    if date_match:
                        raw_date_part = date_match.group(1)
                        desc_part1 = line[len(raw_date_part):].strip()
                        
                        i += 1
                        if i >= len(lines): break
                        amount_line = lines[i].strip()
                        amounts = amount_pattern.findall(amount_line)
                        if not amounts:
                            # It's possible the amounts are on the NEXT line (if desc spanned lines).
                            # For simplicity, we fallback to skipping this chunk if amounts are not right after.
                            continue
                            
                        i += 1
                        if i >= len(lines): break
                        year_line = lines[i].strip()
                        year_match = re.search(r'^(\d{4})', year_line)
                        year = ""
                        desc_part2 = year_line
                        if year_match:
                            year = year_match.group(1)
                            desc_part2 = year_line[4:].strip()
                            
                        full_date = raw_date_part + year
                        full_desc = f"{desc_part1} {desc_part2}".strip()
                        
                        raw_amount = amounts[0].replace(',', '')
                        is_credit = any(kw in full_desc.lower() for kw in ["dep", "deposit", "refund", "credit", "knet", "incoming"])
                        
                        transactions.append({
                            "raw_date": full_date,
                            "raw_desc": full_desc or "POS Transaction",
                            "raw_amount": raw_amount,
                            "raw_credit": raw_amount if is_credit else None
                        })
                    else:
                        i += 1
    except Exception as e:
        logger.error(f"Error in extract_kib_aseel: {e}")
        
    return transactions

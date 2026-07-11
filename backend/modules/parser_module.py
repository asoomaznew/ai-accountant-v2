import os
import re
import logging
from datetime import datetime
from typing import Any, Dict, List

import pdfplumber
import pandas as pd

logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────
DEFAULT_ACCOUNT_NAME = os.getenv("DEFAULT_ACCOUNT_NAME", "Warba Medical Polyclinic")
# Pattern accepts: DD-MMM-YY, DD-MMM-YYYY, DD/MM/YY, DD/MM/YYYY, DD.MM.YYYY, etc.
# Allows both English month abbrev (Jan/Feb/...) and numeric months.
_DATE_PATTERN = re.compile(
    r"^(\d{2}[-/](?:\d{2}|\w{3,4})[-/]\d{2,4})"
)
# Allow 2- or 3-decimal amount for KD (3 decimals) and other currencies (2 decimals)
_AMOUNT_PATTERN = re.compile(r"[\d,]+\.\d{2,3}")
_ACCOUNT_PATTERN = re.compile(
    r"(?:Account\s*Number|A/C\s*No\.?|Account)\s*[:\-]?\s*([\w\d\-]+)",
    re.IGNORECASE,
)
_CREDIT_KEYWORDS = (
    "dep", "deposit", "transfer in", "salary", "credit", "refund", "inward", "receipt"
)
_DATE_PARSE_DAYFIRST = True  # DD-MM-YYYY is common in Kuwait


def _safe_parse_date(date_str: str) -> str:
    """Parse a free-form date string and return ISO YYYY-MM-DD, or the original on failure."""
    try:
        return pd.to_datetime(
            date_str, dayfirst=_DATE_PARSE_DAYFIRST, errors="raise"
        ).strftime("%Y-%m-%d")
    except (ValueError, TypeError) as exc:
        logger.debug("Could not parse date '%s': %s", date_str, exc)
        return date_str


def _is_credit(description: str) -> bool:
    desc_lower = description.lower()
    return any(kw in desc_lower for kw in _CREDIT_KEYWORDS)


def _parse_pdf(file_path: str) -> tuple[str, List[Dict[str, Any]]]:
    """Extract account number + raw transaction rows from a PDF statement."""
    account_number = "Unknown"
    raw_data: List[Dict[str, Any]] = []

    with pdfplumber.open(file_path) as pdf:
        full_text = "\n".join(
            (page.extract_text() or "") for page in pdf.pages
        )

    acc_match = _ACCOUNT_PATTERN.search(full_text)
    if acc_match:
        account_number = acc_match.group(1)

    for line in full_text.splitlines():
        line = line.strip()
        if not line:
            continue

        date_match = _DATE_PATTERN.match(line)
        if not date_match:
            continue

        date_str = date_match.group(1)
        amounts = _AMOUNT_PATTERN.findall(line)
        if not amounts:
            continue

        first_amount_idx = line.find(amounts[0])
        if first_amount_idx == -1:
            continue
        desc = line[len(date_str):first_amount_idx].strip(" -|:\t")
        try:
            amount_val = float(amounts[0].replace(",", ""))
        except ValueError:
            logger.debug("Skipping unparseable amount '%s' on line: %s", amounts[0], line)
            continue

        raw_data.append(
            {
                "date": _safe_parse_date(date_str),
                "description": desc,
                "amount": amount_val,
                "type": "credit" if _is_credit(desc) else "debit",
            }
        )

    return account_number, raw_data


def _parse_tabular(file_path: str) -> List[Dict[str, Any]]:
    """Extract transactions from a CSV/XLSX statement using pandas."""
    if file_path.lower().endswith(".csv"):
        df = pd.read_csv(file_path)
    else:
        df = pd.read_excel(file_path)

    if len(df.columns) < 3:
        logger.warning("Tabular file has <3 columns: %s", file_path)
        return []

    # Normalize column names to lower-case for keyword matching
    df.columns = [str(c).lower() for c in df.columns]

    date_col = next((c for c in df.columns if "date" in c), df.columns[0])
    desc_col = next(
        (c for c in df.columns if "desc" in c or "detail" in c or "narration" in c),
        df.columns[1],
    )
    # Prefer columns that contain 'amount' and are NOT 'balance'
    amount_col = next(
        (
            c
            for c in df.columns
            if ("amount" in c or "debit" in c or "credit" in c) and "balance" not in c
        ),
        df.columns[2],
    )

    # Vectorized parsing (much faster than iterrows)
    parsed_dates = pd.to_datetime(df[date_col], dayfirst=_DATE_PARSE_DAYFIRST, errors="coerce")
    amount_series = (
        df[amount_col]
        .astype(str)
        .str.replace(",", "", regex=False)
    )
    amount_numeric = pd.to_numeric(amount_series, errors="coerce")
    descriptions = df[desc_col].fillna("").astype(str)

    mask = amount_numeric.notna()
    iso_dates = parsed_dates.dt.strftime("%Y-%m-%d").where(mask, "")

    transactions: List[Dict[str, Any]] = []
    for date_val, desc, amt in zip(iso_dates[mask], descriptions[mask], amount_numeric[mask]):
        transactions.append(
            {
                "date": date_val,
                "description": desc,
                "amount": abs(amt),
                "type": "credit" if amt > 0 else "debit",
            }
        )

    return transactions


def parse_warba_statement(file_path: str, filename: str) -> dict:
    """
    Fast extraction of transactions using pdfplumber (for PDF) and pandas (for CSV/XLSX).

    Returns a dict with keys: accountName, accountNumber, transactions.
    """
    account_name = DEFAULT_ACCOUNT_NAME
    account_number = "Unknown"
    transactions: List[Dict[str, Any]] = []

    try:
        if file_path.lower().endswith(".pdf"):
            account_number, raw_data = _parse_pdf(file_path)
            if raw_data:
                # Pandas is used to normalize and clean the extracted rows
                df = pd.DataFrame(raw_data)
                df["amount"] = df["amount"].abs()
                transactions = df.to_dict("records")

        elif file_path.lower().endswith((".csv", ".xlsx", ".xls")):
            transactions = _parse_tabular(file_path)

        else:
            logger.warning("Unsupported file extension for %s", filename)

    except FileNotFoundError:
        logger.error("File not found: %s", file_path)
        raise
    except (pdfplumber.exceptions.PDFSyntaxError,) if hasattr(pdfplumber, "exceptions") else ():
        logger.exception("PDF parsing error for %s", filename)
        raise
    except Exception:
        logger.exception("Unexpected error parsing %s", filename)
        raise

    logger.info("Parsed %s: %d transactions", filename, len(transactions))
    return {
        "accountName": account_name,
        "accountNumber": account_number,
        "transactions": transactions,
    }
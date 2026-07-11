import json
from modules.merchant_accounting import generate_merchant_journal_entries

dummy_data = {
    "accountName": "AL ASEEL INTERNATIONAL POLYCLINIC",
    "accountNumber": "KIBAA-2380",
    "transactions": [
        {"date": "2024-07-01", "description": "POS purchase from KNET", "amount": 150.500, "type": "credit"},
        {"date": "2024-07-01", "description": "KNET TFR CHARGE", "amount": 0.500, "type": "debit"},
        {"date": "2024-07-01", "description": "Fees", "amount": 2.500, "type": "debit"},
        {"date": "2024-07-02", "description": "Transfer deposit KNET", "amount": 100.0, "type": "credit"},
        {"date": "2024-07-03", "description": "Salary credit", "amount": 5000.0, "type": "credit"},
    ]
}

entries = generate_merchant_journal_entries(dummy_data)
print(json.dumps(entries, indent=2))

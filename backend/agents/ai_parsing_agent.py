import re
import json
import logging
from typing import Dict, Any
from modules.llm_gateway import ask_llm

logger = logging.getLogger(__name__)

class AIParsingAgent:
    """
    Agent responsible for calling the LLM gateway to parse extracted text
    into a structured JSON document representing transactions.
    """
    async def parse_transactions(self, raw_text: str, account_name: str, account_number: str) -> Dict[str, Any]:
        prompt = (
            "You are an expert financial data extraction API.\n"
            f"Analyze the following statement text. Your task is to:\n"
            f"1. Standardize/Verify account holder name: {account_name}.\n"
            f"2. Identify or verify the bank Account Number: {account_number}.\n"
            "3. Extract ALL transactions (both CREDIT and DEBIT deposits/withdrawals/fees). DO NOT MISS OR SKIP A SINGLE TRANSACTION.\n"
            "4. For each transaction, identify its type as either 'credit' or 'debit'.\n"
            "5. The amount must always be a positive absolute number.\n"
            "6. Format the extracted data into a JSON object that strictly follows this schema:\n"
            "{\n"
            "  \"accountName\": \"string\",\n"
            "  \"accountNumber\": \"string\",\n"
            "  \"transactions\": [\n"
            "    { \"date\": \"YYYY-MM-DD\", \"description\": \"string\", \"amount\": number, \"type\": \"credit\" or \"debit\" }\n"
            "  ]\n"
            "}\n"
            "CRITICAL: Return ONLY a valid JSON object. Do not include any explanation or markdown formatting.\n\n"
            f"Document Text:\n---\n{raw_text[:80000]}\n---"
        )

        try:
            logger.info("AIParsingAgent: Requesting structured parsing from LLM")
            llm_response = await ask_llm(prompt)
            llm_response = re.sub(r'^```json\s*', '', llm_response)
            llm_response = re.sub(r'\s*```$', '', llm_response)
            
            parsed_data = json.loads(llm_response.strip())
            return parsed_data
        except Exception as e:
            logger.error(f"Error in AIParsingAgent parsing: {e}")
            # Return minimal empty structure on failure
            return {
                "accountName": account_name,
                "accountNumber": account_number,
                "transactions": []
            }

import logging
from typing import List, Dict, Any, Optional
from modules.llm_gateway import ask_llm

logger = logging.getLogger(__name__)

class ChatbotAgent:
    """
    Agent responsible for routing user chat prompts to the active LLM provider.
    """
    async def chat(
        self,
        user_message: str,
        provider: Optional[str] = "auto",
        model: Optional[str] = None,
        context: Optional[List[Dict[str, Any]]] = None,
        custom_system_prompt: Optional[str] = None
    ) -> str:
        logger.info(f"ChatbotAgent: Processing user message")
        
        system_prompt = custom_system_prompt or "You are an expert AI accounting assistant for the AI Accountant v2 system."
        
        # Build prompt including chat context if present
        prompt_parts = [system_prompt]
        if context:
            prompt_parts.append("Conversation history:")
            for msg in context:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                prompt_parts.append(f"{role.upper()}: {content}")
        
        prompt_parts.append(f"USER: {user_message}")
        full_prompt = "\n".join(prompt_parts)
        
        response = await ask_llm(full_prompt)
        return response

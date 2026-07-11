import { getLLMConfig, callLocalLLM } from "./localLlmService";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const authHeader = (): string =>
  `Bearer ${import.meta.env.VITE_BACKEND_TOKEN ?? (import.meta.env.DEV ? 'local_bypass_token' : '')}`;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const modelsChain = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

export const getApiKey = (): string => {
    // For legacy reasons or if components check it directly, we return a dummy string if we are using the proxy.
    return "proxy-enabled";
};

export const generateContentWithRetry = async (aiParams: any, maxRetries = 3): Promise<any> => {
    const config = typeof window !== 'undefined' ? getLLMConfig() : { provider: 'gemini' as const };
    
    if (config.provider === 'none') {
        throw new Error("__BACKEND_REDIRECT__");
    }

    if (config.provider !== 'gemini') {
        return callLocalLLM(aiParams.contents, aiParams.config?.responseSchema, '', '');
    }

    let attempt = 0;
    let modelIndex = 0;
    while (attempt < maxRetries) {
        const originalModel = aiParams.model;
        let currentModel = originalModel;
        
        if (modelsChain.includes(originalModel)) {
            currentModel = modelsChain[Math.min(modelIndex, modelsChain.length - 1)];
        }
        
        const params = { ...aiParams, model: currentModel };
        
        try {
            const res = await fetch(`${BACKEND_URL}/api/gemini/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader()
                },
                body: JSON.stringify(params)
            });
            
            if (!res.ok) {
                const errorText = await res.text();
                const err: any = new Error(errorText);
                err.status = res.status;
                err.message = errorText;
                throw err;
            }
            
            const data = await res.json();
            return data; // Expected { text: "..." }
            
        } catch (error: any) {
            console.error(`Gemini proxy call failed with model ${currentModel}:`, error);
            
            const isPermissionOrNotFound = error?.status === 403 || 
                                          error?.code === 403 || 
                                          error?.message?.includes('403') || 
                                          error?.message?.includes('permission') ||
                                          error?.message?.includes('PERMISSION_DENIED') ||
                                          error?.status === 404 ||
                                          error?.code === 404 ||
                                          error?.message?.includes('404') ||
                                          error?.message?.includes('not found') ||
                                          error?.message?.includes('NOT_FOUND');
            
            if (isPermissionOrNotFound) {
                if (modelsChain.includes(originalModel) && modelIndex < modelsChain.length - 1) {
                    modelIndex++;
                    console.warn(`Permission or Not Found error on model ${currentModel}. Switching to next fallback model: ${modelsChain[modelIndex]}`);
                    continue; 
                }
            }
            
            if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('Quota exceeded')) {
                const match = error?.message?.match(/Please retry in (\d+\.?\d*)s/);
                const waitSeconds = match ? parseFloat(match[1]) : Math.pow(2, attempt) * 10;
                console.warn(`Rate limit hit. Retrying in ${waitSeconds} seconds... (Attempt ${attempt + 1}/${maxRetries})`);
                await delay(waitSeconds * 1000 + 1000); 
                attempt++;
            } else {
                throw error;
            }
        }
    }
    throw new Error('Max retries exceeded for Gemini API.');
};

export const checkApiKeyForGemini = () => {
  return true; // proxy-enabled by default
};

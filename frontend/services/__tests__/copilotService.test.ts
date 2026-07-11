import { describe, it, expect } from 'vitest';
import { extractStructuredResponse } from '../copilotService';

describe('copilotService - extractStructuredResponse', () => {
  it('should extract thoughts and content correctly', () => {
    const fullText = "<thoughts>Analyzing request to switch layout.</thoughts>\nI am happy to assist you!";
    const result = extractStructuredResponse(fullText);
    
    expect(result.thoughts).toBe("Analyzing request to switch layout.");
    expect(result.content).toBe("I am happy to assist you!");
    expect(result.actionJson).toBe("");
    expect(result.suggestions).toEqual([]);
  });

  it('should extract thoughts, actions, and suggestions', () => {
    const fullText = `
<thoughts>
The user wants to navigate to settings. I will trigger the action.
</thoughts>
Executing page change...
<action>
{
  "type": "navigate_to",
  "page": "ai_settings"
}
</action>
Done!
<suggestions>
View mappings
Go to Home
</suggestions>
    `;
    const result = extractStructuredResponse(fullText);
    
    expect(result.thoughts).toBe("The user wants to navigate to settings. I will trigger the action.");
    expect(result.actionJson).toBe('{\n  "type": "navigate_to",\n  "page": "ai_settings"\n}');
    expect(result.content).toBe("Executing page change...\n\nDone!");
    expect(result.suggestions).toEqual(["View mappings", "Go to Home"]);
  });

  it('should support streaming partial thoughts gracefully', () => {
    const fullText = "<thoughts>Analyzing context and records...";
    const result = extractStructuredResponse(fullText);
    
    expect(result.thoughts).toBe("Analyzing context and records...");
    expect(result.content).toBe("");
    expect(result.actionJson).toBe("");
  });
});

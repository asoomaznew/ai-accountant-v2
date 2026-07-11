<RULE[gcp_auth]>
When the user wants to configure Google Cloud authentication, particularly for the Gemini Enterprise Agent Platform or Application Default Credentials (ADC):
1. **Production**: Application Default Credentials (ADC) are recommended.
2. **Local shell**: Use `gcloud auth application-default login` to set up ADC.
3. **Alternative**: You can use the provided setup script via `curl -sSL https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.sh`.
4. **Testing**: You can use a Google Cloud API key for testing, but ADC is required for production.
</RULE[gcp_auth]>

<RULE[oauth_credentials]>
When interacting with Google Cloud APIs or setting up OAuth for the application, use the following credentials for the production environment:
- **Project ID**: `ai-acc-prod-17651`
- **OAuth Client ID**: `522999543290-nd4ht1lof8ja7r30dgmupulfccuns04p.apps.googleusercontent.com`
</RULE[oauth_credentials]>

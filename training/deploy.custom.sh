#!/bin/bash

# Exit on any error
set -e

# Configuration
REGION="us-central1" # Cloud Run GPU is available in us-central1
JOB_NAME="ai-accountant-train-job"

echo "=================================================="
echo "🤖 Starting AI Accountant GPU Training Deployment"
echo "=================================================="

# 1. Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed. Please install it first."
    exit 1
fi

# 2. Get active project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
    echo "❌ Error: No active Google Cloud project. Please set one using:"
    echo "   gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi
echo "✅ Active Google Cloud Project: $PROJECT_ID"

# Define Bucket name
BUCKET_NAME="ai-accountant-training-${PROJECT_ID}"
IMAGE_TAG="gcr.io/${PROJECT_ID}/ai-accountant-train:latest"

# 3. Create GCS bucket if it doesn't exist
echo "Checking if bucket gs://${BUCKET_NAME} exists..."
if ! gcloud storage buckets describe gs://${BUCKET_NAME} &>/dev/null; then
    echo "Creating GCS bucket gs://${BUCKET_NAME} in region ${REGION}..."
    gcloud storage buckets create gs://${BUCKET_NAME} --location=${REGION}
    echo "✅ GCS Bucket created successfully."
else
    echo "✅ GCS Bucket gs://${BUCKET_NAME} already exists."
fi

# 4. Upload dataset.jsonl to GCS
DATASET_SOURCE="../dataset.jsonl"
if [ ! -f "$DATASET_SOURCE" ]; then
    echo "❌ Error: dataset.jsonl not found at $DATASET_SOURCE"
    exit 1
fi

echo "Uploading dataset.jsonl to GCS..."
gcloud storage cp "$DATASET_SOURCE" "gs://${BUCKET_NAME}/dataset.jsonl"
echo "✅ Dataset uploaded successfully."

# 5. Build docker container via Cloud Build (AMD64 architecture with GPU libraries)
echo "Submitting docker build to Cloud Build..."
# Run from the directory where Dockerfile is located
cd "$(dirname "$0")"
gcloud builds submit --tag "$IMAGE_TAG" --gcs-source-staging-dir="gs://${BUCKET_NAME}/staging" .
echo "✅ Cloud Build completed successfully. Image pushed to ${IMAGE_TAG}"

# 6. Deploy Cloud Run Job with GPU
echo "Deploying Cloud Run Job: ${JOB_NAME} with NVIDIA L4 GPU..."
# We use 'gcloud beta run jobs deploy' or 'gcloud beta run jobs create'
# If job exists, we update it, otherwise create it.
if gcloud beta run jobs describe "${JOB_NAME}" --region="${REGION}" &>/dev/null; then
    echo "Job already exists. Updating job..."
    gcloud beta run jobs update "${JOB_NAME}" \
        --image "$IMAGE_TAG" \
        --gpu 1 \
        --gpu-type nvidia-l4 \
        --cpu 4 \
        --memory 16Gi \
        --region "${REGION}" \
        --set-env-vars "BUCKET_NAME=${BUCKET_NAME},DATASET_NAME=dataset.jsonl"
else
    echo "Creating new job..."
    gcloud beta run jobs create "${JOB_NAME}" \
        --image "$IMAGE_TAG" \
        --gpu 1 \
        --gpu-type nvidia-l4 \
        --cpu 4 \
        --memory 16Gi \
        --region "${REGION}" \
        --set-env-vars "BUCKET_NAME=${BUCKET_NAME},DATASET_NAME=dataset.jsonl"
fi
echo "✅ Cloud Run Job deployed successfully."

# 7. Execute the training job
echo "=================================================="
echo "🚀 Executing the training job now..."
echo "=================================================="
gcloud beta run jobs execute "${JOB_NAME}" --region "${REGION}" --wait

echo "=================================================="
echo "🎉 Fine-tuning job completed!"
echo "Your trained GGUF model will be uploaded to gs://${BUCKET_NAME}/model_haitham_accountant.gguf"
echo "Check your GCS bucket to download the model!"
echo "=================================================="

FROM unsloth/unsloth:latest

# Install google-cloud-storage
RUN pip install --no-cache-dir google-cloud-storage

WORKDIR /app

# Copy the training script
COPY train.py /app/train.py

# Run the training script
CMD ["python", "train.py"]

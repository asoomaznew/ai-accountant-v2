import os
import torch
from google.cloud import storage
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

def download_blob(bucket_name, source_blob_name, destination_file_name):
    """Downloads a blob from the bucket."""
    print(f"Downloading {source_blob_name} from bucket {bucket_name} to {destination_file_name}...")
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(source_blob_name)
    blob.download_to_filename(destination_file_name)
    print("Download completed.")

def upload_blob(bucket_name, source_file_name, destination_blob_name):
    """Uploads a file to the bucket."""
    print(f"Uploading {source_file_name} to bucket {bucket_name} as {destination_blob_name}...")
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_filename(source_file_name)
    print("Upload completed.")

def main():
    bucket_name = os.getenv("BUCKET_NAME")
    dataset_name = os.getenv("DATASET_NAME", "dataset.jsonl")
    local_dataset = "dataset.jsonl"
    
    if not bucket_name:
        raise ValueError("Environment variable BUCKET_NAME must be set.")
        
    # Step 1: Download dataset from GCS
    download_blob(bucket_name, dataset_name, local_dataset)
    
    # Step 2: Initialize FastLanguageModel
    max_seq_length = 2048
    print("Loading model and tokenizer...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
        max_seq_length = max_seq_length,
        load_in_4bit = True,
    )
    
    # Step 3: Get PEFT Model
    print("Configuring PEFT (LoRA)...")
    model = FastLanguageModel.get_peft_model(
        model,
        r = 16,
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha = 16,
        lora_dropout = 0,
        bias = "none",
    )
    
    # Step 4: Load and Format Dataset
    print("Loading dataset...")
    dataset = load_dataset("json", data_files=local_dataset)
    
    def format_prompts(batch):
        texts = []
        for prompt, response in zip(batch["prompt"], batch["response"]):
            text = f"### Instruction:\n{prompt}\n\n### Response:\n{response}"
            texts.append(text)
        return { "text" : texts }
        
    dataset = dataset.map(format_prompts, batched = True)
    
    # Step 5: Trainer configuration
    print("Initializing SFTTrainer...")
    trainer = SFTTrainer(
        model = model,
        tokenizer = tokenizer,
        train_dataset = dataset["train"],
        dataset_text_field = "text",
        max_seq_length = max_seq_length,
        dataset_num_proc = 2,
        packing = False,
        args = TrainingArguments(
            per_device_train_batch_size = 2,
            gradient_accumulation_steps = 4,
            warmup_steps = 5,
            max_steps = 60,
            learning_rate = 2e-4,
            fp16 = not torch.cuda.is_bf16_supported(),
            bf16 = torch.cuda.is_bf16_supported(),
            logging_steps = 1,
            output_dir = "outputs",
        ),
    )
    
    # Step 6: Start training
    print("Starting training...")
    trainer.train()
    print("Training finished successfully.")
    
    # Step 7: Save model locally as GGUF
    model_dir = "model_haitham_accountant"
    print(f"Saving model as GGUF to {model_dir}...")
    model.save_pretrained_gguf(model_dir, tokenizer, quantization_method = "q4_k_m")
    
    # Find the generated GGUF file
    gguf_filename = None
    for file in os.listdir(model_dir):
        if file.endswith(".gguf"):
            gguf_filename = os.path.join(model_dir, file)
            break
            
    if not gguf_filename:
        # Check current directory just in case save_pretrained_gguf saved it directly there or in a subpath
        for root, dirs, files in os.walk(model_dir):
            for file in files:
                if file.endswith(".gguf"):
                    gguf_filename = os.path.join(root, file)
                    break
            if gguf_filename:
                break
                
    if not gguf_filename:
        raise FileNotFoundError("GGUF model file was not found after saving.")
        
    print(f"GGUF model saved at: {gguf_filename}")
    
    # Step 8: Upload back to GCS
    destination_blob = os.path.basename(gguf_filename)
    upload_blob(bucket_name, gguf_filename, destination_blob)
    print("All tasks completed successfully!")

if __name__ == "__main__":
    main()

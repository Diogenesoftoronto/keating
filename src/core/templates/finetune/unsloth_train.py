#!/usr/bin/env python3
import argparse

from datasets import load_dataset
from trl import SFTConfig, SFTTrainer
from unsloth import FastLanguageModel


parser = argparse.ArgumentParser(description="Fine-tune a model on Keating export data with Unsloth.")
parser.add_argument("--data", default="train.chatml.jsonl")
parser.add_argument("--model", default="unsloth/gemma-3-4b-it")
parser.add_argument("--out", default="keating-lora")
parser.add_argument("--max-seq-length", type=int, default=4096)
parser.add_argument("--epochs", type=float, default=1)
args = parser.parse_args()

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=args.model,
    max_seq_length=args.max_seq_length,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
)

dataset = load_dataset("json", data_files=args.data, split="train")


def render(example):
    if "messages" in example:
        return {"text": tokenizer.apply_chat_template(example["messages"], tokenize=False)}
    instruction = example.get("instruction", "")
    input_text = example.get("input", "")
    output = example.get("output", "")
    prompt = f"### Instruction:\n{instruction}\n\n### Input:\n{input_text}\n\n### Response:\n{output}"
    return {"text": prompt}


dataset = dataset.map(render, remove_columns=dataset.column_names)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=SFTConfig(
        output_dir=args.out,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=args.epochs,
        learning_rate=2e-4,
        logging_steps=10,
        max_seq_length=args.max_seq_length,
    ),
)
trainer.train()
model.save_pretrained(args.out)
tokenizer.save_pretrained(args.out)

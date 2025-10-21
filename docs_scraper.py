import requests
import re
import json
import zzz
from typing import List, Dict, Optional
from supabase import create_client, Client # Install: pip install supabase

# --- 1. CONFIGURATION ---

# This is now a placeholder ID as the Drive script dictates the ID
DOCUMENT_ID = '1nQqd3CHu510B1lSlXfcxyrbI10ZeaBj9' 
EXPORT_URL = f'https://docs.google.com/document/d/{DOCUMENT_ID}/export?format=txt'


# Supabase Configuration (UPDATE THESE)
SUPABASE_URL = zzz.SUPABASE_URL
SUPABASE_KEY = zzz.SUPABASE_KEY # Use your Service Role key for production inserts
SUPABASE_TABLE_NAME = "questions" # The name of your Supabase table

# Exporting the table name so drive_scraper can use it
__all__ = ['fetch_document_text', 'scrape_and_structure', 'insert_into_supabase', 'SUPABASE_TABLE_NAME']


# --- 2. DATA FETCHING ---

def fetch_document_text(url: str) -> Optional[str]:
    """Fetches the raw plain text content of the public Google Doc."""
    try:
        print(f"Fetching raw text from: {url}")
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers)
        
        response.raise_for_status() 
        
        raw_text = response.text
        cleaned_text = raw_text.replace('\xa0', ' ').replace('\u200b', '').strip()

        return cleaned_text
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP Error: {e}. Check if the document ID is correct and if the document is truly public.")
        return None
    except requests.exceptions.RequestException as e:
        print(f"❌ Request Error: {e}")
        return None

# --- 3. DATA PARSING ---

def parse_answer_key(key_block: str) -> Dict[int, str]:
    """
    Parses the final block of correct answers into a dictionary mapping Q# to Answer Letter.
    """
    answer_key = {}
    key_matches = re.findall(r'(\d+)\s*\)\s*([A-D])', key_block, re.IGNORECASE)
    
    for q_num_str, answer_letter in key_matches:
        try:
            answer_key[int(q_num_str)] = answer_letter.upper()
        except ValueError:
            continue
            
    return answer_key

def parse_qa_block(qa_block: str, answer_key: Dict[int, str], topic: str) -> List[Dict]:
    """
    Parses the main QA block, extracts all data, and combines it with the answer key.
    The 'topic' parameter is used for the Supabase column.
    """
    
    QA_PATTERN = re.compile(
        # 1. Capture Q_Num and start Q_Text
        r'(\d+)\s*\)\s*(.*?)\s*'                                # (G1: Q_Num) (G2: Q_Text)
        
        # 2. Capture Option A (G3) - Uses Negative Lookbehind for (ROA) fix
        r'(?<![a-zA-Z])A\)\s*(.*?)\s*'                          # A) Option A (G3)
        
        # 3. Capture Option B (G4) - Should also use negative lookbehind for consistency
        r'(?<![a-zA-Z])B\)\s*(.*?)\s*'                          # B) Option B (G4)
        
        # 4. Capture Option C (G5) - Should also use negative lookbehind for consistency
        r'(?<![a-zA-Z])C\)\s*(.*?)\s*'                          # C) Option C (G5)
        
        # 5. Capture Option D (G6) - Should also use negative lookbehind for consistency
        r'(?<![a-zA-Z])D\)\s*(.*?)'                             # D) Option D (G6)
        
        # 6. Lookahead for the start of the next question or the end of the string
        r'(?=\s*\d+\s*\)\s*|$)',   
        re.DOTALL | re.IGNORECASE
    )
    
    URL_PATTERN = re.compile(r'\s*(https?:\/\/[^\s]+)\s*', re.IGNORECASE)
    all_questions = []
    bad_questions = [] # TODO: this doesn't get used anywhere yet
    
    for match in QA_PATTERN.finditer(qa_block):
        q_num = int(match.group(1).strip())
        raw_question_text = match.group(2).strip()

        if "\r" in raw_question_text:
            print(f"Parsing error found in question {q_num}: {raw_question_text}. Skipping...")
            bad_questions.append(q_num)
            continue
        
        # --- MEDIA URL EXTRACTION AND CLEANUP ---
        media_url = None
        url_match = URL_PATTERN.search(raw_question_text)
        
        if url_match:
            media_url = url_match.group(1).strip()
            cleaned_question_text = URL_PATTERN.sub('', raw_question_text).strip()
        else:
            cleaned_question_text = raw_question_text
        
        # --- ROBUST CLEANUP FOR OPTION D ---
        option_d_text = match.group(6).strip()
        KEY_FOOTER_PATTERN = r'(\r?\n\s*){2,}.*Key|Answer\s*Key|Correct\s*Answers.*|2016\s+SLC\s+Business.*'
        cleaned_option_d = re.sub(KEY_FOOTER_PATTERN, '', option_d_text, flags=re.DOTALL | re.IGNORECASE).strip()
        cleaned_option_d = re.sub(r'\s+', ' ', cleaned_option_d).strip()
        
        # --- STRUCTURE DATA ---
        option_texts = {
            'A': match.group(3).strip(),
            'B': match.group(4).strip(),
            'C': match.group(5).strip(),
            'D': cleaned_option_d,
        }

        correct_letter = answer_key.get(q_num, 'Key Missing')
        correct_answer_text = option_texts.get(correct_letter, 'N/A')
        
        # Create the structured record
        record = {
            "topic": topic, # Use the passed topic argument
            "question_text": cleaned_question_text,
            "media_url": media_url,
            "choices": [
                option_texts['A'],
                option_texts['B'],
                option_texts['C'],
                option_texts['D']
            ],
            "answer": correct_answer_text
        }
        all_questions.append(record)
    with open("bad_questions.txt", 'a') as f:
        f.write(bad_questions)
    return all_questions

# --- MODIFIED FUNCTION SIGNATURE TO ACCEPT TOPIC ---
def scrape_and_structure(raw_text: str, topic: str) -> List[Dict]:
    """Splits the text into QA block and Key block, then parses both."""
    
    key_header_match = re.search(r'(Correct\s*Answers|Answer\s*Key)', raw_text, re.IGNORECASE)

    qa_block = raw_text
    key_block = ""
    
    if key_header_match:
        qa_block = raw_text[:key_header_match.start()]
        key_block = raw_text[key_header_match.start():]
    else:
        key_block = raw_text

    answer_key = parse_answer_key(key_block)
    structured_data = parse_qa_block(qa_block, answer_key, topic)
    
    return structured_data

# --- 4. SUPABASE IMPORT (No change) ---

def insert_into_supabase(records: List[Dict], table_name: str):
    if not records:
        print("No records to insert. Exiting.")
        return

    try:
        # Initialize the Supabase client
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        print(f"\nAttempting to insert {len(records)} records into table '{table_name}'...")

        # Perform the bulk insertion
        data, count = supabase.table(table_name).insert(records).execute()
        
        print(f"\n✅ Successfully inserted {count[1]} records into Supabase table '{table_name}'.")

    except Exception as e:
        print(f"\n❌ Supabase insertion error. Check your URL, Key, and Table Name.")
        print(f"Error details: {e}")
        
if __name__ == '__main__':
    # This block is for manual testing of a single document
    print("Run 'python drive_scraper.py' to process the folder.")
    pass

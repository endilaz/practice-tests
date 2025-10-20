import requests
import argparse
import re
import json
import zzz
from typing import List, Dict, Optional
from supabase import create_client, Client # Install: pip install supabase

# --- 1. CONFIGURATION ---

# The unique ID from the URL: 
# https://docs.google.com/document/d/1p61dSCB8GuAKs067QFCTvR6V-BWTYFDJ/edit
DOCUMENT_ID = '1nQqd3CHu510B1lSlXfcxyrbI10ZeaBj9' 
EXPORT_URL = f'https://docs.google.com/document/d/{DOCUMENT_ID}/export?format=txt'
TOPIC = "N/A"

# Supabase Configuration (UPDATE THESE)
SUPABASE_URL = zzz.SUPABASE_URL
SUPABASE_KEY = zzz.SUPABASE_KEY # Use your Service Role key for production inserts
SUPABASE_TABLE_NAME = "questions" # The name of your Supabase table

# --- 2. DATA FETCHING ---

def fetch_document_text(url: str) -> Optional[str]:
    """Fetches the raw plain text content of the public Google Doc."""
    try:
        print(f"Fetching raw text from: {url}")
        # Use a simple GET request on the export URL
        # Docs export should work without headers, but adding a user-agent 
        # is a good practice for web scraping.
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers)
        
        # Raise an exception for bad status codes (4xx or 5xx)
        response.raise_for_status() 
        
        # Strip extraneous whitespace and replace common artifacts
        raw_text = response.text
        
        # Clean up common non-breaking space characters, but keep newlines for parsing logic
        cleaned_text = raw_text.replace('\xa0', ' ').replace('\u200b', '').strip()

        print("Fetch successful. Starting parsing...")
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
    Format: [question number]) [correct letter]
    """
    answer_key = {}
    # Find all occurrences of the pattern: number) letter
    # (\d+) captures the question number (Group 1)
    # ([A-D]) captures the correct letter (Group 2)
    key_matches = re.findall(r'(\d+)\s*\)\s*([A-D])', key_block, re.IGNORECASE)
    
    for q_num_str, answer_letter in key_matches:
        try:
            answer_key[int(q_num_str)] = answer_letter.upper()
        except ValueError:
            # Should not happen if regex is correct, but safe check
            continue
            
    return answer_key

def parse_qa_block(qa_block: str, answer_key: Dict[int, str]) -> List[Dict]:
    """
    Parses the main QA block, extracts all data, and combines it with the answer key.
    
    The regex is designed to capture all parts of a question sequentially, 
    relying only on the 'X)' and 'A)' markers as boundaries.
    """
    
    QA_PATTERN = re.compile(
        r'(\d+)\s*\)\s*(.*?)\s*'   # 1) Q_Num | Q_Text (Raw content to be cleaned)
        r'(?<![a-zA-Z])A\)\s*(.*?)\s*'          # A) Option A
        r'B\)\s*(.*?)\s*'          # B) Option B
        r'C\)\s*(.*?)\s*'          # C) Option C
        r'D\)\s*(.*?)'             # D) Option D
        r'(?=\s*\d+\s*\)\s*|$)',   # Lookahead: next Q_Num) or End of String ($)
        re.DOTALL | re.IGNORECASE
    )
    
    # Regex to find a URL, including the surrounding whitespace/newlines
    # It looks for http:// or https:// and captures everything non-whitespace after it.
    URL_PATTERN = re.compile(r'\s*(https?:\/\/[^\s]+)\s*', re.IGNORECASE)
    
    all_questions = []
    
    # Iterate through all matches found in the QA block
    for match in QA_PATTERN.finditer(qa_block):
        q_num = int(match.group(1).strip())
        raw_question_text = match.group(2).strip()
        
        # --- MEDIA URL EXTRACTION AND CLEANUP ---
        media_url = None
        
        # Search for the URL pattern in the raw question text
        url_match = URL_PATTERN.search(raw_question_text)
        
        if url_match:
            # 1. Extract the URL (Group 1 of the URL_PATTERN)
            media_url = url_match.group(1).strip()
            
            # 2. Remove the URL and surrounding whitespace from the text
            cleaned_question_text = URL_PATTERN.sub('', raw_question_text).strip()
        else:
            cleaned_question_text = raw_question_text
        
        # --- ROBUST CLEANUP FOR OPTION D (THE END BLOCK) ---
        option_d_text = match.group(6).strip()
        
        # Pattern to remove large vertical whitespace blocks and key/footer text
        KEY_FOOTER_PATTERN = r'(\r?\n\s*){2,}.*Key|Answer\s*Key|Correct\s*Answers.*|2016\s+SLC\s+Business.*'
        
        # 1. Remove the key/footer text using the aggressive pattern
        cleaned_option_d = re.sub(KEY_FOOTER_PATTERN, '', option_d_text, flags=re.DOTALL | re.IGNORECASE).strip()

        # 2. Finally, replace any remaining embedded newlines or excessive internal spaces with a single space
        cleaned_option_d = re.sub(r'\s+', ' ', cleaned_option_d).strip()
        
        # --- NEW LOGIC FOR OPTIONS ARRAY AND CORRECT ANSWER TEXT ---
        
        # 1. Collect all option texts into a dictionary for easy lookup
        option_texts = {
            'A': match.group(3).strip(),
            'B': match.group(4).strip(),
            'C': match.group(5).strip(),
            'D': cleaned_option_d,
        }

        # 2. Get the correct letter (e.g., 'B') from the answer key
        correct_letter = answer_key.get(q_num, 'Key Missing')
        
        # 3. Determine the correct answer text
        correct_answer_text = option_texts.get(correct_letter, 'N/A')
        
        # Create the structured record
        # Create the structured record
        record = {
            # NEW: Column matching 'topic' from Supabase schema
            "topic": TOPIC, 
            # Existing: Column matching 'question_text'
            "question_text": cleaned_question_text,
            # Existing: Column matching 'media_url'
            "media_url": media_url,
            # RENAMED: 'options' changed to 'choices' (matches JSONB column)
            "choices": [
                option_texts['A'],
                option_texts['B'],
                option_texts['C'],
                option_texts['D']
            ],
            # RENAMED: 'correct_answer' changed to 'answer' (matches text column)
            "answer": correct_answer_text
        }
        all_questions.append(record)
        
    return all_questions


def scrape_and_structure(raw_text: str) -> List[Dict]:
    """Splits the text into QA block and Key block, then parses both."""
    
    # Find the start of the key section using an assumption about its header.
    key_header_match = re.search(r'(Correct\s*Answers|Answer\s*Key)', raw_text, re.IGNORECASE)

    qa_block = raw_text
    key_block = ""
    
    if key_header_match:
        # If a header is found, split the text into two blocks
        qa_block = raw_text[:key_header_match.start()]
        key_block = raw_text[key_header_match.start():]
    else:
        # Fallback: assume the key starts near the end of the text. 
        # This is very fragile. We will use the raw text for both and let 
        # the answer key regex find the key pattern.
        key_block = raw_text

    # Step 2: Parse the Key block
    print("Parsing answer key...")
    answer_key = parse_answer_key(key_block)
    print(f"Found {len(answer_key)} keys.")
    
    # Step 3: Parse the QA block
    print("Parsing question and options block...")
    structured_data = parse_qa_block(qa_block, answer_key)
    print(f"Found {len(structured_data)} questions.")
    
    return structured_data

# --- 4. SUPABASE IMPORT ---

def insert_into_supabase(records: List[Dict], table_name: str):
    if not records:
        print("No records to insert. Exiting.")
        return

    try:
        # Initialize the Supabase client
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        print(f"\nAttempting to insert {len(records)} records into table '{table_name}'...")

        # Perform the bulk insertion
        # Note: If you use the anonymous key (Anon), your RLS policies must allow it.
        # For server-side imports, using the Service Role Key is recommended.
        data, count = supabase.table(table_name).insert(records).execute()
        
        # count[1] returns the count of inserted rows
        print(f"\n✅ Successfully inserted {count[1]} records into Supabase table '{table_name}'.")

    except Exception as e:
        print(f"\n❌ Supabase insertion error. Check your URL, Key, and Table Name.")
        print(f"Error details: {e}")
        
parser = argparse.ArgumentParser(description='Import into Supabase from online source.')
def get_input():
    global TOPIC, EXPORT_URL, DOCUMENT_ID
    parser.add_argument('topic', help='The name of the topic.')
    parser.add_argument('-export_url', help='The URL of the document to import.')
    parser.add_argument('-doc_id', help='The ID of the Google Docs to import.')
    args = parser.parse_args()
    TOPIC = args.topic
    if args.export_url:
        EXPORT_URL = args.export_url

if __name__ == '__main__':
    get_input()
    raw_text = fetch_document_text(EXPORT_URL)
    
    if raw_text:
        # 1. Scrape and structure the data
        final_data = scrape_and_structure(raw_text)
        
        if final_data:
            print("\n" + "=" * 60)
            print("SAMPLE STRUCTURED DATA (Check for media_url):")
            print("=" * 60)
            # Find and print the first record with a media URL, or just the first record
            sample_record = next((item for item in final_data if "Hometown" in item.get('question_text')), final_data[0])
            print(json.dumps(sample_record, indent=4))
            
            print("\n" + "=" * 60)
            print(f"Total Records Ready: {len(final_data)}")
            print("=" * 60)
            
            # 2. Insert into Supabase (UNCOMMENT THE LINE BELOW TO EXECUTE INSERTION)
            insert_into_supabase(final_data, SUPABASE_TABLE_NAME)
        else:
            print("Parsing failed to extract any structured questions.")

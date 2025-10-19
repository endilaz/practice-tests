import requests
import re
import json
from typing import List, Dict, Optional
# from supabase import create_client, Client # Install: pip install supabase

# --- 1. CONFIGURATION ---

# The unique ID from the URL: 
# https://docs.google.com/document/d/1p61dSCB8GuAKs067QFCTvR6V-BWTYFDJ/edit
DOCUMENT_ID = '1nQqd3CHu510B1lSlXfcxyrbI10ZeaBj9' 
EXPORT_URL = f'https://docs.google.com/document/d/{DOCUMENT_ID}/export?format=txt'

# Supabase Configuration (UPDATE THESE)
# SUPABASE_URL = "YOUR_SUPABASE_URL"
# SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY" # Use your Service Role key for production inserts
# SUPABASE_TABLE_NAME = "quiz_questions" # The name of your Supabase table

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
    
    # This non-greedy regex attempts to capture the entire structure of one question:
    # 1. (\d+)           -> Q_Num (Group 1)
    # 2. (.*?)           -> Question Text (Group 2, non-greedy match up to A))
    # 3. A\)\s*(.*?)     -> Option A Text (Group 3, non-greedy up to B))
    # 4. B\)\s*(.*?)     -> Option B Text (Group 4, non-greedy up to C))
    # 5. C\)\s*(.*?)     -> Option C Text (Group 5, non-greedy up to D))
    # 6. D\)\s*(.*?)     -> Option D Text (Group 6, non-greedy up to next question num or end)
    # re.DOTALL makes '.' match newlines, crucial for dense text.
    QA_PATTERN = re.compile(
        r'(\d+)\s*\)\s*(.*?)\s*'  # 1) Q_Num | Q_Text
        r'A\)\s*(.*?)\s*'          # A) Option A
        r'B\)\s*(.*?)\s*'          # B) Option B
        r'C\)\s*(.*?)\s*'          # C) Option C
        r'D\)\s*(.*?)'             # D) Option D
        r'(?=\s*\d+\s*\)\s*|$)',   # Lookahead: next Q_Num) or End of String ($)
        re.DOTALL | re.IGNORECASE
    )
    
    all_questions = []
    
    # Iterate through all matches found in the QA block
    for match in QA_PATTERN.finditer(qa_block):
        q_num = int(match.group(1).strip())
        
        # --- ROBUST CLEANUP FOR OPTION D (THE END BLOCK) ---
        option_d_text = match.group(6).strip()
        
        # Pattern to remove large vertical whitespace blocks and key/footer text
        # This targets multiple newlines/whitespace followed by any text (like a key/title)
        KEY_FOOTER_PATTERN = r'(\r?\n\s*){2,}.*Key|Answer\s*Key|Correct\s*Answers.*|2016\s+SLC\s+Business.*'
        
        # 1. Remove the key/footer text using the aggressive pattern
        cleaned_option_d = re.sub(KEY_FOOTER_PATTERN, '', option_d_text, flags=re.DOTALL | re.IGNORECASE).strip()

        # 2. Finally, replace any remaining embedded newlines or excessive internal spaces with a single space
        cleaned_option_d = re.sub(r'\s+', ' ', cleaned_option_d).strip()
        
        # Create the structured record
        record = {
            "question_number": q_num,
            "question_text": match.group(2).strip(),
            "option_A": match.group(3).strip(),
            "option_B": match.group(4).strip(),
            "option_C": match.group(5).strip(),
            "option_D": cleaned_option_d,
            "correct_answer": answer_key.get(q_num, 'Key Missing')
        }
        all_questions.append(record)
        
    return all_questions


def scrape_and_structure(raw_text: str) -> List[Dict]:
    """Splits the text into QA block and Key block, then parses both."""
    
    # Step 1: Find the split point (where the answer key likely begins)
    # We look for the first instance of a key-like pattern (e.g., 10) A)
    # If the text is dense, the split is difficult. We assume the Key starts 
    # after the last question block, possibly marked by "Correct Answers" or similar
    # text, which must be handled in the regex cleanup.
    
    # A simple split is to find the first occurrence of a number followed by a closing 
    # parenthesis and a single letter, which is common in key sections.
    # However, since the QA block also uses num), we look for a high Q number like 
    # Q90 to signal the end of the Q/A section, or rely on explicit key wording.
    
    # Best effort: Find the last Q/A record using the loop in parse_qa_block, and 
    # remove the content matched so far from the start of the text.
    
    # For robust parsing, we'll try to split the text block only once to get the key.
    # The key is likely after the last question. Let's assume the question list 
    # ends at or before Q100 and the Key starts immediately after, or at a heading.
    
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
"""
def insert_into_supabase(records: List[Dict], table_name: str):
    \"""Connects to Supabase and bulk inserts the records.\"""
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
        print("\nNote: Ensure your Supabase table has the following columns (all of type TEXT/VARCHAR or INTEGER for Q#):\n"
              "  - question_number\n  - question_text\n  - option_A\n  - option_B\n  - option_C\n  - option_D\n  - correct_answer")
"""

if __name__ == '__main__':
    raw_text = fetch_document_text(EXPORT_URL)
    
    if raw_text:
        # 1. Scrape and structure the data
        final_data = scrape_and_structure(raw_text)
        
        if final_data:
            print("\n" + "=" * 60)
            print("SAMPLE STRUCTURED DATA (last Question):")
            print("=" * 60)
            print(json.dumps(final_data[-20:], indent=4))
            
            print("\n" + "=" * 60)
            print(f"Total Records Ready: {len(final_data)}")
            print("=" * 60)
            
            # 2. Insert into Supabase (UNCOMMENT THE LINE BELOW TO EXECUTE INSERTION)
            # insert_into_supabase(final_data, SUPABASE_TABLE_NAME)
        else:
            print("Parsing failed to extract any structured questions.")

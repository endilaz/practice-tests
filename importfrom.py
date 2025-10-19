import argparse
import requests
import json
# from supabase import create_client, Client # Install: pip install supabase

def fetch_document_text(url):
    """Fetches the raw text content of the public Google Doc."""
    try:
        # Use a simple GET request on the export URL
        response = requests.get(url)
        
        # Raise an exception for bad status codes (4xx or 5xx)
        response.raise_for_status() 
        
        # The content is returned as a single string
        return response.text
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e}. Check if the document ID is correct and if the document is truly public.")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Request Error: {e}")
        return None

def scrape(url: str):
    print(f"Scraping URL: {url}")
    # Fetch the text
    raw_text = fetch_document_text(url)
    question_texts = []
    choices = []
    answers = []

    if raw_text:
        print("-" * 50)
        print("RAW SCRAPED TEXT (First 500 characters):")
        print("-" * 50)
        print(raw_text[-500:])
        # raw_text is now ready for parsing
        state = 0 # 0 = nothing, 1 = reading question text, 2 = reading answer choice, 3 = reading correct answer
        for c in range(raw_text):
            if raw_text[c].isdecimal(): 
                if c + 1 < len(raw_text) and raw_text[c + 1] == ')':
                    # start of question or answer number
                    dig_start = c
                    while raw_text[dig_start-1].isdecimal():
                        dig_start -= 1
                    question_number = int(raw_text[dig_start:c+1])
                    state = 1
                else:
                    # included in text or not final digit in question/answer number
                    pass
            if raw_text[c:c+2] in "A)B)C)D)":
                # start of answer choice
                
                pass

        lines = raw_text.split('\n')
        current_question = 0
        answers_started = False
        for i in range(len(lines)):
            line = lines[i].strip()
            print(f"Processing line: {line}")
            if current_question == 100:
                answers_started = True
                current_question = 0
                input("Parsing answers now. Press Enter to continue...")
            if not answers_started:
                if line.startswith(f"{current_question+1})"):
                    current_question += 1
                    question_texts.append(line[line.find(")")+1:].strip())
                    print(f"Question {current_question}: {question_texts[-1]}")
                # elif line.startswith("A)"):
                    i += 1
                    choices.append([lines[x].strip()[line.find(")"):].strip() for x in range(i, i+4)]) # Next 4 lines are choices
                    print(f"Choices: {choices[-1]}")
                    i += 3
            else:
                if line.startswith(f"{current_question+1})"):
                    current_question += 1
                    print(f"Processing answer {lines[i+1].strip()}")
                    answers.append(choices[current_question-1][(ord(lines[i+1].strip()) - ord('A'))]) # The answer is on the next line
                    print(f"{current_question} answer: {answers[-1]}")
        input("Finished parsing. Press Enter to display results...")
        print("-" * 50)
        print("PARSED QUESTIONS, CHOICES, AND ANSWERS:")
        print("-" * 50)
        for i, (q, c, a) in enumerate(zip(question_texts, choices, answers)):
            print(f"Q{i+1}: {q}")
            for choice in c:
                print(f"   {choice}")
            print(f"Answer: {a}")
            print()
        
# 1. CONFIGURATION
# -----------------
DOCUMENT_ID = '1p61dSCB8GuAKs067QFCTvR6V-BWTYFDJ' 
EXPORT_URL = f'https://docs.google.com/document/d/{DOCUMENT_ID}/export?format=txt'

# Supabase Configuration
SUPABASE_URL = "YOUR_SUPABASE_URL"
SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY" # Use your Service Role key for production inserts



parser = argparse.ArgumentParser()
if __name__ == "__main__":
    parser.add_argument('topic', type=str, help='The topic of the test to scrape')
    parser.add_argument('URL', type=str, help='The URL of the page to scrape')
    args = parser.parse_args()
    scrape(args.URL)
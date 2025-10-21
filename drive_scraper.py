import os
import sys
import argparse
import re
import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from collections import deque 
from typing import List, Dict

# Import functions from the document scraper file
# NOTE: Ensure docs_scraper.py is in the same directory and has all its functions defined.
from docs_scraper import fetch_document_text, scrape_and_structure, insert_into_supabase, SUPABASE_TABLE_NAME 

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
CREDENTIALS_FILE = 'credentials.json' # Download this from Google Cloud Console

# The folder ID from your URL: https://drive.google.com/drive/folders/1nO2RkQTGv4EXQ9myxirF8hmOUSd-d6zF
FOLDER_ID = '1nO2RkQTGv4EXQ9myxirF8hmOUSd-d6zF' 
FILE_NAME_PREFIX = '2016'
MIME_TYPE_GOOGLE_DOCS = 'application/vnd.google-apps.document'
MIME_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
MIME_TYPE_FOLDER = 'application/vnd.google-apps.folder' # Added for folder type

# Pattern to extract the topic name from the file name:
# e.g., '2016 SLC Business Calculations' -> 'Business Calculations'
TOPIC_PATTERN = re.compile(r'2016\s+SLC\s+(.*)', re.IGNORECASE)

# --- 1. AUTHENTICATION ---

def authenticate_drive():
    """Authenticates with the Google Drive API using OAuth 2.0."""
    creds = None
    # The file token.json stores the user's access and refresh tokens.
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    
    # If there are no valid credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("Refreshing existing credentials...")
            creds.refresh(Request())
        else:
            print("Starting new OAuth flow...")
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Save the credentials for the next run
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return creds

# --- 2. DRIVE TRAVERSAL AND SEARCH (UPDATED FOR RECURSION) ---

def find_all_matching_docs(service, start_folder_id: str, file_prefix: str) -> List[Dict]:
    """
    Recursively searches the folder structure for Google Docs files matching the prefix 
    using a Breadth-First Search (BFS) approach.
    """
    
    # Queue for BFS, starting with the initial folder ID
    folder_queue = deque([start_folder_id])
    matching_files = []
    
    print(f"Starting recursive search from folder ID: {start_folder_id}...")

    while folder_queue:
        current_folder_id = folder_queue.popleft()
        page_token = None
        
        # Query to find both matching documents AND subfolders in the current directory
        # We look for files matching the prefix OR items that are folders
        query = (
            f"'{current_folder_id}' in parents and "
            f"trashed = false and ("
            # Condition 1: Find a matching document
            f"(mimeType = '{MIME_TYPE_DOCX}' and name starts with '{file_prefix}') "
            f"or "
            # Condition 2: Find a subfolder to traverse
            f"(mimeType = '{MIME_TYPE_FOLDER}')"
            f")"
        )

        try:
            while True:
                response = service.files().list(
                    # We need name, id, and mimeType to distinguish between folders and files
                    q=query,
                    fields="nextPageToken, files(id, name, mimeType)",
                    pageToken=page_token
                ).execute()
                
                for item in response.get('files', []):
                    # Check if it's a folder: if so, add it to the queue for later traversal
                    if item.get('mimeType') == MIME_TYPE_FOLDER:
                        print(f"  > Found subfolder: {item.get('name')}. Adding to queue.")
                        folder_queue.append(item['id'])
                    
                    # Check if it's a matching document: if so, add it to the results
                    elif item.get('mimeType') == MIME_TYPE_DOCX and item.get('name', '').startswith(file_prefix):
                        matching_files.append(item)
                    
                page_token = response.get('nextPageToken', None)
                if not page_token:
                    break
        
        except HttpError as error:
            print(f'An error occurred while searching folder {current_folder_id}: {error}')
            # Stop if there's an error in one folder
            break 
            
    return matching_files

# --- 3. MAIN EXECUTION ---

def main():
    
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"Error: Credentials file not found at '{CREDENTIALS_FILE}'")
        print("Please follow setup instructions to download your Google Drive API credentials.")
        sys.exit(1)
        
    try:
        # 1. Authenticate
        creds = authenticate_drive()
        service = build('drive', 'v3', credentials=creds)

        # 2. Find all matching Docs (now recursive)
        matching_files = find_all_matching_docs(service, FOLDER_ID, FILE_NAME_PREFIX)
        
        if not matching_files:
            print("\nNo matching Google Docs found after recursive search. Exiting.")
            return

        print(f"\nFound {len(matching_files)} total documents to process.")
        
        all_questions = []

        # 3. Process each found document
        for file in matching_files:
            doc_id = file['id']
            doc_name = file['name']
            
            # --- Extract Topic from File Name ---
            topic_match = TOPIC_PATTERN.search(doc_name)
            if topic_match:
                # The topic is Group 1 of the regex. We then strip all known suffixes (.docx, - Key)
                doc_topic_raw = topic_match.group(1).strip()
                
                # Strip known suffixes: '- Key' and file extensions (.docx, .doc)
                doc_topic = doc_topic_raw.split(' - Key')[0]
                doc_topic = re.sub(r'\.(docx|doc)$', '', doc_topic, flags=re.IGNORECASE).strip()
            else:
                doc_topic = f"Uncategorized: {doc_name}" # Fallback topic
            # ------------------------------------
            
            # Construct the export URL for the individual document
            doc_export_url = f'https://docs.google.com/document/d/{doc_id}/export?format=txt'
            
            print(f"\n--- Processing Document: '{doc_name}' ---")
            print(f"--- Extracted Topic: '{doc_topic}' ---")
            ok = input("Continue with this topic? ").lower()
            while ok == "change topic":
                doc_topic = input("Please enter the new topic: ")
                ok = input("Continue with this topic? ").lower()
            if ok != "yes":
                print("Skipping this document...")
                continue
            
            # A. Fetch raw text using the function from docs_scraper
            raw_text = fetch_document_text(doc_export_url)
            
            if raw_text:
                # B. Scrape and structure the data using the function from docs_scraper
                structured_data = scrape_and_structure(raw_text, doc_topic) 
                
                print(f"  ✅ Scraped {len(structured_data)} questions from this file.")
                with open("CHECK_SCRAPING.txt", 'w') as f:
                    f.write(json.dumps(structured_data, indent=2))
                ok = input("OK to continue parsing? Check file CHECK_SCRAPING.txt: ")
                if ok == "yes":
                    all_questions.extend(structured_data)
                else:
                    print("Discarding scraped content...")
                    continue
            else:
                print(f"  ❌ Failed to fetch content for {doc_name}.")
                
        # 4. Bulk Insert into Supabase
        if all_questions:
            print(f"\n--- Starting Bulk Insert: {len(all_questions)} Total Questions ---")
            # SUPABASE_TABLE_NAME is imported from docs_scraper
            with open("CHECK_SCRAPING.txt", 'w') as f:
                f.write(json.dumps(all_questions, indent=2))
            ok = input("Check scraping. OK to insert? ").lower()
            if ok == "yes":
                insert_into_supabase(all_questions, SUPABASE_TABLE_NAME)
        
    except HttpError as error:
        print(f'An API error occurred: {error}')
    except ImportError as e:
        print(f"\n❌ ImportError: {e}. Please ensure 'docs_scraper.py' and 'drive_scraper.py' are in the same directory.")
        print("You may also need to install the required Google libraries: pip install google-api-python-client google-auth-oauthlib google-auth-httplib2")


if __name__ == '__main__':
    main()

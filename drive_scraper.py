import os
import sys
import argparse
import re
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

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

# --- 2. DRIVE TRAVERSAL AND SEARCH ---

def find_matching_docs(service, folder_id: str, file_prefix: str):
    """Recursively searches the folder for Google Docs files matching the prefix."""
    
    # The Google Drive API query (Q) is powerful for filtering server-side
    query = (
        f"'{folder_id}' in parents and "
        f"mimeType = '{MIME_TYPE_GOOGLE_DOCS}' and "
        f"name starts with '{file_prefix}' and "
        "trashed = false"
    )

    results = []
    page_token = None
    print(f"Searching for Google Docs starting with '{file_prefix}' in folder '{folder_id}'...")

    while True:
        try:
            response = service.files().list(
                q=query,
                fields="nextPageToken, files(id, name)",
                pageToken=page_token
            ).execute()
            
            for file in response.get('files', []):
                results.append(file)
            
            page_token = response.get('nextPageToken', None)
            if not page_token:
                break
        except HttpError as error:
            print(f'An error occurred: {error}')
            break
            
    return results

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

        # 2. Find all matching Docs
        matching_files = find_matching_docs(service, FOLDER_ID, FILE_NAME_PREFIX)
        
        if not matching_files:
            print("No matching Google Docs found. Exiting.")
            return

        print(f"\nFound {len(matching_files)} documents to process.")
        
        all_questions = []

        # 3. Process each found document
        for file in matching_files:
            doc_id = file['id']
            doc_name = file['name']
            
            # --- Extract Topic from File Name ---
            topic_match = TOPIC_PATTERN.search(doc_name)
            if topic_match:
                # The topic is Group 1 of the regex, stripped of extra space/key text
                doc_topic = topic_match.group(1).split(' - Key')[0].strip()
            else:
                doc_topic = f"Uncategorized: {doc_name}" # Fallback topic
            # ------------------------------------
            
            # Construct the export URL for the individual document
            doc_export_url = f'https://docs.google.com/document/d/{doc_id}/export?format=txt'
            
            print(f"\n--- Processing Document: {doc_name} ---")
            print(f"--- Extracted Topic: {doc_topic} ---")
            input("Continue...?")
            
            # A. Fetch raw text using the function from docs_scraper
            raw_text = fetch_document_text(doc_export_url)
            
            if raw_text:
                # B. Scrape and structure the data using the function from docs_scraper
                structured_data = scrape_and_structure(raw_text, doc_topic) 
                all_questions.extend(structured_data)
                
                print(f"  ✅ Scraped {len(structured_data)} questions from this file.")
            else:
                print(f"  ❌ Failed to fetch content for {doc_name}.")
                
        # 4. Bulk Insert into Supabase
        if all_questions:
            print(f"\n--- Starting Bulk Insert: {len(all_questions)} Total Questions ---")
            # SUPABASE_TABLE_NAME is imported from docs_scraper
            # insert_into_supabase(all_questions, SUPABASE_TABLE_NAME)
            print(all_questions)
        
    except HttpError as error:
        print(f'An API error occurred: {error}')
    except ImportError as e:
        print(f"\n❌ ImportError: {e}. Please ensure 'docs_scraper.py' and 'drive_scraper.py' are in the same directory.")
        print("You may also need to install the required Google libraries: pip install google-api-python-client google-auth-oauthlib google-auth-httplib2")


if __name__ == '__main__':
    main()

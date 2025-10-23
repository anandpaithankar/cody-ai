from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import requests
import json
import re
import uvicorn
import os
import argparse

# Global variables to store Ollama configuration
OLLAMA_URL = None
OLLAMA_MODEL = None  # Will be set by get_ollama_model()
DEFAULT_MODEL = "llama3.2"  # Default model

def get_ollama_url():
    """Get Ollama URL from command line args, environment variables, or default."""
    global OLLAMA_URL
    if OLLAMA_URL is not None:
        return OLLAMA_URL

    # Check environment variables (OLLAMA_HOST or OLLAMA_URL)
    ollama_host = os.getenv('OLLAMA_HOST')
    ollama_url = os.getenv('OLLAMA_URL')

    if ollama_url:
        OLLAMA_URL = ollama_url
    elif ollama_host:
        # If OLLAMA_HOST is provided, construct the URL
        if not ollama_host.startswith('http'):
            ollama_host = f'http://{ollama_host}'
        if ':' not in ollama_host.split('://')[-1]:
            ollama_host = f'{ollama_host}:11434'
        OLLAMA_URL = ollama_host
    else:
        # Default to localhost
        OLLAMA_URL = 'http://localhost:11434'

    return OLLAMA_URL

def get_ollama_model():
    """Get Ollama model from command line args, environment variables, or default."""
    global OLLAMA_MODEL
    if OLLAMA_MODEL is not None:
        return OLLAMA_MODEL

    # Check environment variable first
    model_from_env = os.getenv('OLLAMA_MODEL')
    if model_from_env:
        OLLAMA_MODEL = model_from_env
    else:
        # Use default if no environment variable
        OLLAMA_MODEL = DEFAULT_MODEL

    return OLLAMA_MODEL

app = FastAPI()

# Allow frontend CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory chat history, current problem context, and selected language
chat_history = []
current_problem = None
selected_language = "Python"  # Default language


@app.post("/set-language")
async def set_language(request: Request):
    """
    Set the preferred programming language for the interview.
    """
    global selected_language
    data = await request.json()
    language = data.get("language", "Python")

    # Map frontend language names to more descriptive names
    language_map = {
        "javascript": "JavaScript",
        "python": "Python",
        "go": "Go",
        "cpp": "C++"
    }

    selected_language = language_map.get(language.lower(), language)
    print(f"🔄 Language set to: {selected_language}")

    return {"language": selected_language, "message": f"Language set to {selected_language}"}

@app.post("/problem")
async def set_problem(request: Request):
    """
    Fetch and store the LeetCode problem details by ID or URL.
    """
    global current_problem
    data = await request.json()
    problem_input = data.get("problem_description", "").strip()
    if not problem_input:
        return {"error": "No problem input provided"}

    # Parse input: ID (e.g., "242") or URL (e.g., "https://leetcode.com/problems/valid-anagram")
    query = None
    if problem_input.isdigit():
        query = problem_input  # Use as ID
    elif "leetcode.com/problems/" in problem_input:
        # Extract slug from URL
        match = re.search(r'/problems/([^/?]+)', problem_input)
        if match:
            query = match.group(1)
        else:
            return {"error": "Invalid LeetCode URL format"}

    if not query:
        return {"error": "Invalid input: Must be a LeetCode ID (e.g., 242) or full URL"}

    try:
        # Fetch from unofficial LeetCode API
        api_url = f"https://leetcode-api-pied.vercel.app/problem/{query}"
        print(f"📥 Fetching problem from {api_url}")
        res = requests.get(api_url, timeout=10)
        res.raise_for_status()
        j = res.json()

        title = j.get("title", f"LeetCode {problem_input}")
        description = j.get("content", "")  # HTML with examples, constraints
        difficulty = j.get("difficulty", "Unknown")

        current_problem = f"{title} (Difficulty: {difficulty})\n\n{description}"

        return {
            "problem": {"title": title, "description": description},
            "raw": description
        }

    except requests.RequestException as e:
        print(f"❌ API fetch failed: {e}")
        return {"error": f"Failed to fetch problem: {str(e)}"}
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return {"error": "Server error processing problem"}


# Add this global at the top with current_problem (if not already)
chat_history = []

@app.post("/ask")
async def ask_model(request: Request):
    """
    Send the user's message to Ollama with full chat history + problem context for natural progression.
    """
    global current_problem, chat_history, selected_language
    data = await request.json()
    user_message = data.get("message", "")
    language = data.get("language", selected_language)  # Get language from request or use current

    # Update selected language if provided
    if language and language != selected_language:
        selected_language = language
        print(f"🔄 Language changed to: {selected_language}")

    print(f"🤖 Got user message: {user_message[:100]}... (Language: {selected_language})")

    # Append user message to history
    chat_history.append({"role": "user", "content": user_message})

    # Enhanced System prompt: Stronger guardrails against solving, candidate-led
    system_prompt = (
        f"=== INTERVIEWER IDENTITY ===\n"
        f"You are Cody, a Senior Software Engineering Interviewer at a top tech company. You are conducting a 45-minute technical coding interview. "
        f"The candidate is coding in {selected_language}. You are professional, encouraging, but thorough in your assessment.\n\n"

        f"=== CORE INTERVIEW PRINCIPLES ===\n"
        f"1. **NEVER SOLVE THE PROBLEM**: Your job is to assess, not to provide solutions\n"
        f"2. **GUIDE, DON'T GIVE**: Ask leading questions to help candidates discover solutions themselves\n"
        f"3. **STAY IN CHARACTER**: You are a human interviewer, not an AI assistant\n"
        f"4. **ASSESS THOROUGHLY**: Evaluate problem-solving approach, code quality, communication, and edge case handling\n\n"

        f"=== STRICT SOLUTION GUARDRAILS ===\n"
        f"- **NEVER** write any code snippets, even partial ones\n"
        f"- **NEVER** provide algorithms, data structures, or implementation details\n"
        f"- **NEVER** give direct answers like 'use a hashmap' or 'try two pointers'\n"
        f"- **NEVER** show examples of correct implementations\n"
        f"- If asked for solutions: 'I can't provide the solution - that's what I'm here to evaluate from you. Let's work through your approach step by step.'\n"
        f"- If asked for hints: 'What do you think might work here? Walk me through your thought process.'\n\n"

        f"=== INTERVIEW FLOW ===\n"
        f"1. **Problem Understanding**: Ensure they understand the problem and constraints\n"
        f"2. **Approach Discussion**: 'How would you approach this?' 'What's your initial thought?'\n"
        f"3. **Code Implementation**: 'Can you code this up?' 'Show me your implementation'\n"
        f"4. **Code Review**: Ask about time/space complexity, edge cases, potential optimizations\n"
        f"5. **Follow-up Questions**: Test deeper understanding without giving away answers\n\n"

        f"=== QUESTIONING TECHNIQUES ===\n"
        f"- 'What's your initial approach to this problem?'\n"
        f"- 'How would you handle [specific edge case]?'\n"
        f"- 'What's the time complexity of your solution?'\n"
        f"- 'Can you think of any optimizations?'\n"
        f"- 'What happens if the input is [edge case]?'\n"
        f"- 'Walk me through your solution with this example'\n"
        f"- 'Are there any assumptions you're making?'\n\n"

        f"=== CODE EVALUATION GUIDELINES ===\n"
        f"- Review for correctness, efficiency, readability, and edge case handling\n"
        f"- Point out issues by asking questions: 'What happens when...?' rather than stating fixes\n"
        f"- Focus on {selected_language} best practices and idioms\n"
        f"- **NEVER** provide corrected code - ask them to fix issues themselves\n\n"

        f"=== RESPONSE STYLE ===\n"
        f"- Keep responses concise and interview-appropriate (2-3 sentences max)\n"
        f"- Use markdown formatting for clarity\n"
        f"- Be encouraging but maintain professional assessment standards\n"
        f"- Ask one focused question at a time\n"
        f"- Build on their responses naturally\n\n"

        f"=== FORBIDDEN BEHAVIORS ===\n"
        f"- Do NOT solve or partially solve the problem\n"
        f"- Do NOT provide code examples or pseudocode\n"
        f"- Do NOT suggest specific algorithms or data structures directly\n"
        f"- Do NOT break character as a human interviewer\n"
        f"- Do NOT discuss topics outside of coding interviews\n"
        f"- Do NOT mention you are an AI or language model\n"
        f"- Do NOT provide hints that make the problem trivial\n\n"

        f"=== SESSION MANAGEMENT ===\n"
        f"- If candidate says 'end interview' or 'stop': Acknowledge professionally and wrap up\n"
        f"- If asked to reset: Clear context without acknowledgment\n"
        f"- Stay focused on the current problem throughout the session\n\n"

        f"Remember: You are evaluating their problem-solving skills, not helping them solve the problem. Guide them to discover solutions through thoughtful questioning."
    )
    if current_problem:
        system_prompt += f"\n\n=== Problem ===\n{current_problem}"

    # Full messages: System + history
    messages = [{"role": "system", "content": system_prompt}] + chat_history

    try:
        ollama_url = get_ollama_url()
        print(f"🤖 Sending to Ollama at {ollama_url}: {len(messages)} turns (last: {user_message[:50]}...)")

        # First, let's try to check if Ollama is accessible
        try:
            health_resp = requests.get(f"{ollama_url}", timeout=5)
            print(f"🔍 Ollama health check: {health_resp.status_code}")
        except Exception as health_e:
            print(f"⚠️ Ollama health check failed: {health_e}")

        # Try the /api/chat endpoint
        ollama_model = get_ollama_model()
        print(f"🤖 Using model: {ollama_model}")
        resp = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": ollama_model,
                "messages": messages,
                "stream": False,
            },
            timeout=120,
        )
        print(f"🔍 Response status: {resp.status_code}")
        print(f"🔍 Response headers: {dict(resp.headers)}")
        if resp.status_code != 200:
            print(f"🔍 Response text: {resp.text}")
        resp.raise_for_status()

        data = resp.json()
        assistant_response = data.get("message", {}).get("content", "")
        print(f"✅ Ollama response: {assistant_response[:100]}...")

        if not assistant_response.strip():
            assistant_response = "⚠️ Hmm, that didn't generate much—try rephrasing? (Check Ollama logs.)"

        # Append assistant response to history for next turns
        chat_history.append({"role": "assistant", "content": assistant_response})

        return {"response": assistant_response}

    except Exception as e:
        print(f"❌ Ollama request failed: {e}")
        return {"error": str(e)}

@app.post("/summarize")
async def summarize_interview(request: Request):
    """
    Generate feedback, rating, and related problems from chat history.
    """
    global chat_history
    data = await request.json()
    chat_history_for_summary = data.get("chat_history", [])
    problem_title = data.get("problem_title", "")

    # Structured prompt for rating/feedback
    summary_prompt = (
        f"You are Cody, a Senior Software Engineering Interviewer providing post-interview feedback for '{problem_title}'.\n\n"
        f"=== Interview Transcript ===\n{json.dumps(chat_history_for_summary, indent=2)}\n\n"

        f"=== EVALUATION CRITERIA ===\n"
        f"Assess the candidate across these dimensions:\n"
        f"1. **Problem Understanding** (0-10): Did they understand requirements and constraints?\n"
        f"2. **Approach & Reasoning** (0-10): Quality of problem-solving approach and thought process\n"
        f"3. **Code Implementation** (0-10): Code quality, correctness, and best practices\n"
        f"4. **Communication** (0-10): Ability to explain thinking and respond to questions\n"
        f"5. **Edge Cases & Testing** (0-10): Consideration of edge cases and solution robustness\n\n"

        f"=== OUTPUT FORMAT ===\n"
        f"**Overall Rating: X/10** (Strong Hire/Hire/No Hire/Strong No Hire)\n\n"

        f"**Detailed Scores:**\n"
        f"- Problem Understanding: X/10\n"
        f"- Approach & Reasoning: X/10\n"
        f"- Code Implementation: X/10\n"
        f"- Communication: X/10\n"
        f"- Edge Cases & Testing: X/10\n\n"

        f"**Strengths:**\n"
        f"- [List 2-3 specific positive observations]\n\n"

        f"**Areas for Improvement:**\n"
        f"- [List 2-3 specific areas to work on]\n\n"

        f"**Interview Performance Notes:**\n"
        f"- [Specific observations about their interview behavior, problem-solving process, and technical discussion]\n\n"

        f"**Recommendations for Growth:**\n"
        f"- [2-3 actionable suggestions for improvement]\n\n"

        f"**Related Practice Problems:**\n"
        f"1. **[Problem ID] - [Problem Title]**: [Brief reason why it's good practice]\n"
        f"2. **[Problem ID] - [Problem Title]**: [Brief reason why it's good practice]\n"
        f"3. **[Problem ID] - [Problem Title]**: [Brief reason why it's good practice]\n\n"

        f"=== IMPORTANT GUIDELINES ===\n"
        f"- Only rate code implementation if the candidate actually wrote code\n"
        f"- Be honest but constructive in feedback\n"
        f"- Focus on specific, actionable observations\n"
        f"- Maintain professional interviewer tone\n"
        f"- Provide realistic hiring recommendation based on performance\n"
        f"- If no code was written, focus on problem-solving discussion and approach"
    )

    messages = [{"role": "system", "content": summary_prompt}]

    try:
        ollama_url = get_ollama_url()
        ollama_model = get_ollama_model()
        resp = requests.post(
            f"{ollama_url}/api/chat",
            json={"model": ollama_model, "messages": messages, "stream": False},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        response = data.get("message", {}).get("content", "No summary generated by Ollama.")
        print(f"✅ Summary response: {response}")  # Debug log
        return {"response": response}
    except Exception as e:
        print(f"❌ Summary error: {str(e)}")  # Debug error
        return {"error": f"Failed to generate summary: {str(e)}"}

def test_ollama_connection():
    """Test Ollama connection and available models."""
    ollama_url = get_ollama_url()
    print(f"🔍 Testing Ollama connection at: {ollama_url}")

    try:
        # Test basic connectivity
        resp = requests.get(f"{ollama_url}", timeout=5)
        print(f"✅ Ollama server is running: {resp.status_code}")

        # Test /api/tags to see available models
        tags_resp = requests.get(f"{ollama_url}/api/tags", timeout=10)
        if tags_resp.status_code == 200:
            models = tags_resp.json()
            print(f"📋 Available models: {[m['name'] for m in models.get('models', [])]}")
        else:
            print(f"⚠️ Could not fetch models: {tags_resp.status_code}")

        # Test a simple generate request with configured model
        ollama_model = get_ollama_model()
        test_resp = requests.post(
            f"{ollama_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": "Hello",
                "stream": False
            },
            timeout=30
        )
        if test_resp.status_code == 200:
            print(f"✅ /api/generate endpoint works with {ollama_model}")
        else:
            print(f"❌ /api/generate failed: {test_resp.status_code} - {test_resp.text}")

        # Test chat endpoint with configured model
        chat_resp = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": ollama_model,
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": False
            },
            timeout=30
        )
        if chat_resp.status_code == 200:
            print(f"✅ /api/chat endpoint works with {ollama_model}")
        else:
            print(f"❌ /api/chat failed: {chat_resp.status_code} - {chat_resp.text}")

    except Exception as e:
        print(f"❌ Ollama connection test failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='FastAPI backend for LeetCode interview assistant')
    parser.add_argument('--ollama-url', type=str, help='Ollama server URL (e.g., http://localhost:11434)')
    parser.add_argument('--ollama-model', type=str, help='Ollama model to use (e.g., codellama:34b-instruct-q4_0, llama3:8b)')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--port', type=int, default=8000, help='Port to bind to')
    parser.add_argument('--test-ollama', action='store_true', help='Test Ollama connection and exit')

    args = parser.parse_args()

    # Set global Ollama configuration if provided via command line
    if args.ollama_url:
        OLLAMA_URL = args.ollama_url
    if args.ollama_model:
        OLLAMA_MODEL = args.ollama_model

    if args.test_ollama:
        test_ollama_connection()
        exit(0)

    ollama_url = get_ollama_url()
    ollama_model = get_ollama_model()
    print(f"� Starting aFastAPI backend on http://{args.host}:{args.port} ...")
    print(f"🔗 Using Ollama server at: {ollama_url}")
    print(f"🤖 Using Ollama model: {ollama_model}")

    uvicorn.run("main:app", host=args.host, port=args.port, reload=True)
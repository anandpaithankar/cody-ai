
# Cody : AI Tech Interviewer

Local web app (frontend + backend) that uses Ollama to act as an AI interviewer for LeetCode-style problems.
This package includes:
- FastAPI backend (`server/`) with endpoints: /ask, /problem
- React + Vite frontend (`client/`) with Monaco editor and chat UI
- Tailwind CSS setup for styling

<img width="1685" height="1038" alt="image" src="https://github.com/user-attachments/assets/c109dbd1-70eb-44fb-a638-eda2165cb844" />


## Requirements
- Node 18+, npm
- Python 3.10+, pip
- Docker (optional, for safe code execution)
- Ollama installed and running locally (`ollama serve`)

## Quickstart

1. Clone and Setup
```bash
git clone https://github.com/anandpaithankar/cody-ai.git cody-ai
cd cody-ai
```
2. Start Ollama (in a separate terminal)
```bash
ollama serve  # Runs on http://localhost:11434
ollama pull llama3  # Or your preferred model
```
3. Backend setup
```bash
cd server
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt  # Includes fastapi, uvicorn, requests
uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Runs on http://localhost:8000
```
Backend runs on http://localhost:8000

4. Frontend Setup
Open a new terminal:

```bash
cd client
npm install  # Installs react, @monaco-editor/react, react-markdown, etc.
npm run dev  # Runs on http://localhost:5173 (Vite dev server)
```
Frontend (Vite) runs on http://localhost:5173

5. Run the App

* Open http://localhost:5173 in your browser.
* Enter a LeetCode ID (e.g., "242") or URL → Load → Timer starts (⏱ 45:00).
* Chat: "Hi, approach?" → AI probes (e.g., "Clarify: Edge cases?").
* Editor: Switch lang (e.g., Python), code, Evaluate Code → Feedback in chat.
* End: Timer 0:00 or Complete Interview → Debrief (rating, tips, related loads).
* Off-topic? AI may end: "END OF INTERVIEW" → Auto-feedback.

## Usage Tips

* **Languages:** JS (default), Python, Go, C++—auto-stubs on switch/load.
* **Auto-Features:** Scroll to new messages, Shift+Enter for lines, typing "..." indicator.
* **Related Problems:** Click debrief buttons → Loads fresh interview (clears chat/editor/timer).
* **Customize:** Edit server/main.py for prompt tweaks (e.g., stricter anti-spoilers). Swap Ollama model in /ask endpoint.
* **Debug:** Backend logs to console (e.g., "🤖 Got user message..."). Frontend: Chrome dev tools.

## Troubleshooting

* **Ollama Errors:** Ensure ollama serve runs; check ollama ps for model. Timeout? Increase timeout=120 in main.py.
* **CORS Issues:** Backend allows * origins—fine for local.
* **LeetCode Fetch Fails:** Unofficial API (leetcode-api-pied.vercel.app)—if down, fallback to manual problem paste.
* **Frontend Build: Prod:** npm run build (outputs to dist/), serve with npx serve -s dist.
* **Windows Paths:** Use `.\.venv\Scripts\activate` for `venv`.

## License
MIT—free to use/modify/share.

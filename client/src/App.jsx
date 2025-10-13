import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import Editor from '@monaco-editor/react';

export default function App() {
  const [code, setCode] = useState("// Write your solution here");
  const [language, setLanguage] = useState("javascript");
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState("");
  const [problemInput, setProblemInput] = useState("");
  const [problem, setProblem] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0); // 45 minutes in seconds
  const [screen, setScreen] = useState('interview'); // 'interview' or 'feedback'
  const [feedback, setFeedback] = useState(''); // For end-screen content
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false); // For spinner
  const [isTyping, setIsTyping] = useState(false); // For chat indicator
  const chatRef = useRef(null); // Ref for chat container

  const stripHtml = (html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  };

  const detectEndOfInterview = (response) => {
    // Regex to match various end-of-interview cues,
    // allowing for optional trailing punctuation or whitespace.
    const endPhrasesRegex = new RegExp(
      '\\b(' + // Start of non-capturing group for OR logic
      'end\\s+of\\s+interview|' +
      'goodbye|' +
      'session\\s+ended|' +
      'bye|' +
      'reached\\s+conclusion|' +
      'session\\s+concluded|' +
      'time\\s+to\\s+end\\s+the\\s+session|' +
      'time\\s+to\\s+wrap\\s+up' +
      ')\\b\\W*', // End of group, followed by word boundary and optional non-word characters
      'i' // Case-insensitive flag
    );
    return endPhrasesRegex.test(response);
  };



  // Start timer only when problem is loaded
  useEffect(() => {
    let timer;
    if (timeLeft > 0) { // Only start timer if timeLeft is set (i.e., problem loaded)
      timer = setInterval(() => {
        setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [timeLeft]);

  // Auto-scroll chat to bottom on updates
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chat]);

  // Auto-transition to feedback on timer end
  useEffect(() => {
    if (timeLeft === 0 && screen === 'interview' && chat.length > 0) {
      getFeedback();
      setScreen('feedback');
    }
  }, [timeLeft]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  async function loadProblem(msg = problemInput) {
    if (!msg.trim()) return;
    setChat([]); // Clear chat on new problem
    setProblemInput(msg); // Sync UI input field
    // Reset editor to lang-specific blank
    switch (language) {
      case "python":
        setCode("# Write your solution here\ndef solution():\n    pass\n    return");
        break;
      case "go":
        setCode("// Write your solution here\nfunc solution() {\n    // TODO\n}");
        break;
      case "cpp":
        setCode("// Write your solution here\n#include <iostream>\nusing namespace std;\n\nint main() {\n    // TODO\n    return 0;\n}");
        break;
      default: // javascript
        setCode("// Write your solution here");
        break;
    }
    try {
      const res = await fetch('http://localhost:8000/problem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problem_description: msg }),
      });
      const j = await res.json();
      if (j.error) {
        setChat(prev => [...prev, { role: 'assistant', content: 'Error loading problem: ' + j.error }]);
        return;
      }
      const p = j.problem || { title: 'LeetCode ' + msg, description: j.raw || '' };
      setProblem(p);
      setTimeLeft(45 * 60); // Start timer only after successful load
      console.log('Loaded problem description:', stripHtml(p.description)); // Debug log
      // Auto-start interview with greeting
      const greeting = "Hello Cody! I'm ready to start the interview.";
      setInput(greeting)
      await sendMessage(greeting); // Send the greeting prompt and reset session.
      setInput(""); // Clear input after sending
      if (screen === 'feedback') {
        setScreen('interview'); // Force back to interview
      }
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: 'Server error loading problem.' }]);
    }
  }

  async function sendMessage(msg = input) {
    console.log('Sending message start:', msg); // Debug: Log user message
    if (!msg.trim()) return;
    const userMsg = { role: 'user', content: msg };
    setChat(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true); // Show indicator
    try {
      console.log('Sending message to server:', msg); // Debug: Log user message
      const res = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      const j = await res.json();
      const ai = j.response || j.error || 'No response';
      setChat(prev => [...prev, { role: 'assistant', content: ai }]);
      // Check for end trigger
      if (detectEndOfInterview(ai)) {
        setTimeout(() => completeInterview(), 1000); // Brief pause for read, then auto-end
      }
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: 'Server unreachable' }]);
    } finally {
      setIsTyping(false); // Hide indicator
    }
  }

  async function evaluateCode() {
    if (!code.trim() || !problem) return;
    const evalMessage = `Language: ${language}\nPlease evaluate my code for ${problem.title}:\n\n${code}`;
    setChat(prev => [...prev, { role: 'assistant', content: 'Submitted for evaluation... Please wait...' }]); // Notify user
    setIsTyping(true); // Show indicator
    try {
      const res = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: evalMessage })
      });
      const j = await res.json();
      const ai = j.response || j.error || 'No evaluation response received.';
      // Replace the "Submitted..." message with the evaluation result
      setChat(prev => {
        const newChat = [...prev];
        newChat[newChat.length - 1] = { role: 'assistant', content: ai };
        return newChat;
      });
      // Check for end trigger (e.g., bad code frustration)
      if (detectEndOfInterview(ai)) {
        setTimeout(() => completeInterview(), 1000); // Pause for feedback read
      }
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: 'Server error during evaluation.' }]);
    } finally {
      setIsTyping(false); // Hide indicator
    }
  }

  async function getFeedback() {
    if (!problem || chat.length === 0) return;
    setIsLoadingFeedback(true); // Start spinner
    try {
      const res = await fetch('http://localhost:8000/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_history: chat, problem_title: problem.title })
      });
      const j = await res.json();
      console.log('Feedback response:', j); // Debug: Log server response
      setFeedback(j.response || 'No feedback generated. Check server logs.');
    } catch (e) {
      console.error('Feedback fetch error:', e); // Debug: Log error
      setFeedback('Error fetching feedback. Ensure /summarize endpoint is active.');
    } finally {
      setIsLoadingFeedback(false); // End spinner
    }
  }

  async function completeInterview() {
    if (chat.length > 0) {
      getFeedback();
      setScreen('feedback');
    } else {
      alert('Start an interview first!');
    }
  }

  // Function to reset interview state
  const resetInterview = () => {
    sendMessage("stop session and clear the memory"); // Inform backend to reset session
    setChat([]);
    setProblem(null);
    setProblemInput("");
    setTimeLeft(0); // Reset timer to 0 until new problem loaded
    setInput("");
    setFeedback("");
    setIsLoadingFeedback(false);
    setIsTyping(false);
    // Reset code based on current language
    switch (language) {
      case "python":
        setCode("# Write your solution here\ndef solution():\n    pass\n    return");
        break;
      case "go":
        setCode("// Write your solution here\nfunc solution() {\n    // TODO\n}");
        break;
      case "cpp":
        setCode("// Write your solution here\n#include <iostream>\nusing namespace std;\n\nint main() {\n    // TODO\n    return 0;\n}");
        break;
      default: // javascript
        setCode("// Write your solution here");
        break;
    }
    setTimeout(() => setChat([]), 2000);
  };

  if (screen === 'feedback') {
    // Refined parser: Handle numbered list format for related problems
    const relatedProblems = [];
    let inRelatedSection = false;
    const lines = feedback.split('\n');
    console.log('Feedback lines:', lines); // Debug: Log all lines
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().includes('related problems')) { // Flexible header match
        inRelatedSection = true; // Start capturing after header
        console.log('Found Related Problems header:', trimmed); // Debug header
        return;
      }
      if (inRelatedSection) {
        const numberMatch = trimmed.match(/^\d+\.\s*/); // Match "1. " or "2. "
        if (numberMatch) {
          const titleMatch = trimmed.match(/^\d+\.\s*\*\*"?(.+?)"?\s*\(LeetCode\s*(\d+)\)/i); // Capture title and ID
          console.log('Checking line:', trimmed, 'Title Match:', titleMatch); // Debug each line
          if (titleMatch && titleMatch[2]) { // Ensure ID is captured
            relatedProblems.push({ id: titleMatch[2], title: titleMatch[1].trim() });
            console.log('Detected related problem:', titleMatch[2], titleMatch[1]); // Debug capture
          }
        }
      }
    });

    return (
      <div className="h-screen flex flex-col bg-gray-50 text-gray-900">
        <header className="flex items-center justify-between px-6 py-4 bg-white shadow">
          <h1 className="text-3xl font-bold">🧑‍💻 Cody : AI Tech Interview Feedback</h1>
          <div className="flex items-center gap-4">
            <button onClick={() => { setScreen('interview'); resetInterview(); }} className="bg-blue-600 text-white px-4 py-1 rounded">New Interview</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoadingFeedback ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center space-y-4">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                <p className="text-gray-600">Generating your personalized feedback... (Analyzing chat & code)</p>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="prose prose-lg max-w-none bg-white p-6 rounded-lg shadow">
                <ReactMarkdown
                  remarkPlugins={[remarkBreaks]}
                  components={{
                    code: ({ node, inline, className, children, ...props }) => {
                      const hasLang = /language-(\w+)/.exec(className || '');
                      return !inline ? (
                        <pre className="bg-gray-800 text-white p-3 rounded overflow-auto my-2">
                          <code className={hasLang ? `language-${hasLang[1]}` : ''} {...props}>{children}</code>
                        </pre>
                      ) : (
                        <code className="bg-gray-200 text-gray-800 px-1.5 py-0.5 rounded font-mono text-sm" {...props}>
                          {children}
                        </code>
                      );
                    },
                    p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
                    li: ({ children }) => (
                      <li className="my-2 pl-6 list-disc marker:text-blue-600">
                        {children}
                      </li>
                    ),
                    strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                    em: ({ children }) => <em className="italic text-gray-700">{children}</em>
                  }}
                >
                  {feedback}
                </ReactMarkdown>
              </div>
              {relatedProblems.length > 0 && (
                <div className="bg-blue-50 p-4 rounded border border-blue-200">
                  <h3 className="font-semibold text-blue-800 mb-3">Related Problems (Click to Load)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {relatedProblems.slice(0, 3).map((prob, i) => (
                      <button
                        key={i}
                        onClick={() => loadProblem(prob.id)}
                        className="bg-white p-3 rounded-lg border hover:bg-blue-50 text-left text-sm transition-all shadow-sm hover:shadow-md"
                      >
                        <strong className="text-blue-600">{prob.id}</strong><br />
                        <span className="text-gray-700">{prob.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Interview screen
  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900">
      <header className="flex items-center justify-between px-6 py-4 bg-white shadow">
        <h1 className="text-3xl font-bold">🧑‍💻 Cody : AI Tech Interviewer </h1>
        <div className="flex items-center gap-4">
          <div className="text-l text-gray-600">⏱ {formatTime(timeLeft)}</div>
          <button className="bg-yellow-500 text-white px-4 py-1 rounded" onClick={resetInterview}>Reset Interview</button>
          <button className="bg-red-500 text-white px-4 py-1 rounded" onClick={completeInterview}>Complete Interview</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left - Chat */}
        <div className="w-[45%] min-w-[380px] flex flex-col border-r bg-white">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Interview Chat</h2>
            <p className="text-sm text-gray-500">Code solves problems, but conversation builds solutions.</p>

            <div className="mt-3 flex gap-2">
              <input value={problemInput} onChange={e => setProblemInput(e.target.value)}
                className="flex-1 p-2 border rounded" placeholder="Enter LeetCode id or URL (e.g. 242 or https://leetcode.com/problems/valid-anagram)" />
              <button onClick={() => loadProblem(problemInput)} className="bg-blue-600 text-white px-3 py-1 rounded">Load</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={chatRef}>
            {problem ? (
              <div className="p-4 bg-blue-50 border border-blue-100 rounded">
                <h3 className="font-semibold text-blue-800">{problem.title}</h3>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-auto">
                  {stripHtml(problem.description)}
                </pre>
              </div>
            ) : null}

            {chat.length === 0 ? (
              <div className="text-gray-400 italic"><span>Hello there! 👋 </span></div>
            ) : (
              <>
                {chat.map((msg, i) => (
                  <div key={i} className={`${msg.role === 'user' ? 'justify-end flex' : 'justify-start flex'}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                      {msg.role === 'user' ? (
                        msg.content
                      ) : (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[remarkBreaks]}
                            components={{
                              code: ({ node, inline, className, children, ...props }) => {
                                const hasLang = /language-(\w+)/.exec(className || '');
                                return !inline ? (
                                  <pre className="bg-gray-200 p-2 rounded text-sm overflow-auto"><code {...props}>{children}</code></pre>
                                ) : (
                                  <code className="bg-gray-200 px-1 rounded" {...props}>{children}</code>
                                );
                              },
                              p: ({ children }) => <>{children}</>,
                              li: ({ children }) => <li className="my-1">{children}</li>
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="justify-start flex">
                    <div className="flex space-x-0.5 ml-2">
                      <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                      <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                    {/* <div className="max-w-[80%] px-3 py-2 rounded-2xl bg-gray-100 text-gray-800">
                      <div className="flex items-center space-x-1">
                        <div className="animate-bounce">🧠</div>
                        <span>Thinking...</span>
                        
                      </div>
                    </div> */}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t p-3 flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    e.preventDefault();
                    setInput(prev => prev + '\n');
                  } else {
                    sendMessage();
                  }
                }
              }}
              className="flex-1 p-2 border rounded resize-vertical min-h-[50px] whitespace-pre-wrap"
              placeholder="Type your message..."
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            />
            <button onClick={sendMessage} className="bg-blue-600 text-white px-4 py-2 rounded">Send</button>
          </div>
        </div>

        {/* Right - Editor */}
        <div className="flex-1 flex flex-col bg-gray-900 text-white">
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-800">
            <div className="flex gap-6">
              <button className="text-white border-b-2 border-green-500 pb-1">Notepad</button>
            </div>
            <select
              value={language}
              onChange={(e) => {
                const newLang = e.target.value;
                setLanguage(newLang);
                switch (newLang) {
                  case "python":
                    setCode("# Write your solution here\ndef solution():\n    pass\n    return");
                    break;
                  case "go":
                    setCode("// Write your solution here\nfunc solution() {\n    // TODO\n}");
                    break;
                  case "cpp":
                    setCode("// Write your solution here\n#include <iostream>\nusing namespace std;\n\nint main() {\n    // TODO\n    return 0;\n}");
                    break;
                  default: // javascript
                    setCode("// Write your solution here");
                    break;
                }
              }}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="go">Go</option>
              <option value="cpp">C++</option>
            </select>
          </div>

          <div className="flex-1">
            <Editor
              height="100%"
              language={language}
              value={code}
              onChange={setCode}
              theme="vs-dark"
              options={{
                fontSize: 16,
                fontLigatures: true,
                wordWrap: 'on',
                wrappingIndent: 'indent',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                minimap: { enabled: false }
              }}
            />
          </div>

          <div className="flex justify-end px-6 py-3 border-t border-gray-800 bg-gray-900">
            <button onClick={evaluateCode} className="bg-green-600 px-5 py-2 rounded">Evaluate Code</button>
          </div>
        </div>
      </div>
    </div>
  );
}

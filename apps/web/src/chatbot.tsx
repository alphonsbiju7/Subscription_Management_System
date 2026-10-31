import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Check, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";
import { api, type User } from "./api";
import { getAssistantProfile } from "../../../packages/shared-types/src/assistant";
import "./chatbot.css";

type Source = { label: string; path: string };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };
export function Chatbot({ user }: { user: Pick<User, "name" | "role"> }) {
  const profile = getAssistantProfile(user.role);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !pending) input.current?.focus({ preventScroll: true });
  }, [open, pending]);
  useEffect(() => {
    if (scroll.current)
      scroll.current.scrollTop = messages.length || pending || error ? scroll.current.scrollHeight : 0;
  }, [messages, pending, error, open]);

  function close() {
    setOpen(false);
    launcher.current?.focus({ preventScroll: true });
  }

  async function send(content = question) {
    const text = content.trim();
    if (!text || text.length > 2000 || pending) return;
    const previous = messages;
    // Keep the last three exchanges in the provider's context. The visible log remains intact.
    const history: Message[] = [
      ...messages.slice(-6).map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];
    setMessages([...messages, { role: "user", content: text }]);
    setQuestion("");
    setError("");
    setPending(true);
    try {
      const { reply, sources } = await api<{ reply: string; sources?: Source[] }>("/chat", { messages: history });
      setMessages((current) => [...current, { role: "assistant", content: reply, sources }]);
    } catch (cause) {
      setMessages(previous);
      setQuestion(text);
      setError(cause instanceof Error ? cause.message : "Unable to send your question. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  return (
    <div className="assistant-widget">
      {open && (
        <section
          className="assistant-panel"
          id="brightloop-assistant"
          aria-label="Brightloop assistant"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <header className="assistant-header">
            <span className="assistant-mark"><Sparkles size={21} /></span>
            <div>
              <h2>Brightloop Assistant</h2>
              <p>{profile.label} assistant · Powered by Groq</p>
            </div>
            <div className="assistant-actions">
              <button
                type="button"
                className="assistant-icon-button"
                aria-label="Start a new conversation"
                title="Start a new conversation"
                disabled={pending || !messages.length}
                onClick={() => { setMessages([]); setError(""); setQuestion(""); input.current?.focus({ preventScroll: true }); }}
              >
                <RotateCcw size={16} />
              </button>
              <button type="button" className="assistant-icon-button" aria-label="Close assistant" onClick={close}>
                <X size={19} />
              </button>
            </div>
          </header>
          <div className="assistant-scope">
            {user.role === "ADMIN" ? "Read-only access to your workspace reports and business records."
              : user.role === "CUSTOMER" ? "Read-only access to your own account records only."
                : "Workflow help only. Database lookups are unavailable for your role."}
          </div>
          <div className="assistant-conversation" ref={scroll}>
            {!messages.length && (
              <div className="assistant-welcome">
                <div className="assistant-welcome-icon"><MessageCircle size={26} /></div>
                <span className="assistant-role-badge">{profile.label} workspace</span>
                <h3>{profile.title}</h3>
                <p>Hi {user.name.trim().split(/\s+/)[0] || "there"}, I can help you with:</p>
                <ul className="assistant-capabilities">
                  {profile.capabilities.map((capability) => (
                    <li key={capability}><Check size={14} aria-hidden="true" /><span>{capability}</span></li>
                  ))}
                </ul>
                <span className="assistant-suggestions-label">Try a question</span>
                <div className="assistant-suggestions">
                  {profile.suggestions.map((suggestion) => (
                    <button type="button" key={suggestion} disabled={pending} onClick={() => void send(suggestion)}>
                      {suggestion}<ArrowUp size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
              {messages.map((message, index) => (
                <div className={`assistant-message assistant-message-${message.role}`} key={index}>
                  <span className="assistant-message-label">{message.role === "user" ? "You" : "Brightloop"}</span>
                  <div className="assistant-message-content">
                    {message.role === "assistant" ? (
                      <Markdown
                        skipHtml
                        unwrapDisallowed
                        allowedElements={["p", "strong", "em", "ul", "ol", "li", "code", "pre", "br", "blockquote", "h1", "h2", "h3"]}
                      >
                        {message.content}
                      </Markdown>
                    ) : <p>{message.content}</p>}
                  </div>
                  {!!message.sources?.length && (
                    <nav className="assistant-sources" aria-label="Answer sources">
                      <span>Sources</span>
                      {message.sources.map((source) => <Link key={source.path} to={source.path}>{source.label}</Link>)}
                    </nav>
                  )}
                </div>
              ))}
            </div>
            {pending && <div className="assistant-thinking" role="status"><span />Thinking through your question…</div>}
          </div>
          <form className="assistant-composer" onSubmit={submit}>
            {error && <p className="assistant-error" role="alert">{error} Your question is ready to resend.</p>}
            <label className="assistant-input-label" htmlFor="assistant-question">Ask a question</label>
            <div className="assistant-input-row">
              <textarea
                id="assistant-question"
                ref={input}
                placeholder="Ask about subscriptions, billing…"
                rows={2}
                maxLength={2000}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={pending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="submit" className="assistant-send" aria-label="Send question" disabled={pending || !question.trim()}>
                <ArrowUp size={20} />
              </button>
            </div>
            <p className="assistant-footnote">Messages and permitted lookup results go to Groq. AI can make mistakes.</p>
          </form>
        </section>
      )}
      <button
        type="button"
        className="assistant-launcher"
        ref={launcher}
        aria-expanded={open}
        aria-controls={open ? "brightloop-assistant" : undefined}
        onClick={() => open ? close() : setOpen(true)}
      >
        {open ? <X size={19} /> : <Sparkles size={19} />}
        <span>{open ? "Close assistant" : "Ask Brightloop"}</span>
      </button>
    </div>
  );
}

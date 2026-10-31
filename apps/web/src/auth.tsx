import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Layers3, ShieldCheck } from "lucide-react";
import { authClient } from "./api";
import { ErrorBox, Form } from "./components";
function authenticationError(error: { code?: string; status?: number; message?: string }) {
  if (error.status === 429 || error.code === "TOO_MANY_REQUESTS")
    return new Error("Too many sign-in attempts. Wait a minute, then try again.");
  if (error.code === "EMAIL_NOT_VERIFIED")
    return new Error("Verify your email before signing in. You can request another verification email below.");
  if (error.code === "INVALID_EMAIL_OR_PASSWORD")
    return new Error("Sign-in failed. Check your email and password.");
  if (error.code?.includes("OTP") || error.code?.includes("TOTP"))
    return new Error("That authenticator code is invalid or expired. Enter the current six-digit code.");
  if (error.status === 403 && error.message?.toLowerCase().includes("origin"))
    return new Error("Open Brightloop using its configured workspace address, then sign in again.");
  return new Error(error.message || "Unable to sign in. Check that the backend is running and try again.");
}
export function AuthPage({
  mode = "login",
  done,
}: {
  mode?: "login" | "register" | "reset";
  done: () => void | Promise<void>;
}) {
  const [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false),
    [totp, setTotp] = useState(false),
    [demoEmail, setDemoEmail] = useState(""),
    [verificationEmail, setVerificationEmail] = useState("");
  const inFlight = useRef(false);
  const nav = useNavigate();
  const token = new URLSearchParams(location.search).get("token");
  async function submit(v: Record<string, string>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(undefined);
    setMessage("");
    setVerificationEmail("");
    setPending(true);
    try {
      const email = v.email?.trim().toLowerCase();
      if (!totp && !token && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? ""))
        throw new Error("Enter a valid email address.");
      if (totp) {
        if (!/^\d{6}$/.test(v.code ?? "")) throw new Error("Enter a six-digit authenticator code.");
        const r = await authClient.twoFactor.verifyTotp({ code: v.code! });
        if (r.error) throw authenticationError(r.error);
        await done();
        nav("/");
      } else if (mode === "register") {
        const r = await authClient.signUp.email({
          name: v.name!,
          email: email!,
          password: v.password!,
          callbackURL: `${location.origin}/`,
        });
        if (r.error) throw authenticationError(r.error);
        setMessage(
          "Check your verification email. Local development emails appear in .local/mail when the worker runs.",
        );
      } else if (mode === "reset") {
        const r = token
          ? await authClient.resetPassword({ newPassword: v.password!, token })
          : await authClient.requestPasswordReset({
              email: email!,
              redirectTo: `${location.origin}/reset`,
            });
        if (r.error) throw authenticationError(r.error);
        if (token) {
          history.replaceState({}, "", "/reset");
          setMessage("Password updated. Sign in with your new password.");
        } else
          setMessage(
            "If this account exists, a password reset email has been queued.",
          );
      } else {
        const r = await authClient.signIn.email({
          email: email!,
          password: v.password!,
        });
        if (r.error) {
          if (r.error.code === "EMAIL_NOT_VERIFIED") setVerificationEmail(email!);
          throw authenticationError(r.error);
        }
        if (r.data && "twoFactorRedirect" in r.data && r.data.twoFactorRedirect) setTotp(true);
        else {
          await done();
          nav("/");
        }
      }
    } catch (e) {
      setError(e instanceof TypeError ? new Error("Unable to reach Brightloop. Check that the backend is running and try again.") : e);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  async function resendVerification() {
    if (inFlight.current || !verificationEmail) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await authClient.sendVerificationEmail({ email: verificationEmail, callbackURL: `${location.origin}/` });
      if (result.error) throw authenticationError(result.error);
      setMessage("Verification email requested. Follow the link in your email, then sign in.");
    } catch (error) {
      setError(error);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link to="/login" className="brand">
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>
          brightloop<span className="brand-period">.</span>
        </Link>
        <div>
          <span className="eyebrow">SUBSCRIPTION OS</span>
          <h1>
            Every subscription.
            <br />
            One clear picture.
          </h1>
          <p>
            Your customer agreements, recurring billing and revenue operations,
            connected from the first quote to the next renewal.
          </p>
          <div className="story-motif">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="motif-center">
              <Layers3 size={42} />
            </div>
            <span className="motif-chip chip-one">
              Quote accepted <ShieldCheck size={16} />
            </span>
            <span className="motif-chip chip-two">
              Billing, verified <ArrowUpRight size={16} />
            </span>
          </div>
        </div>
        <small>BRIGHTLOOP SOFTWARE · BUILT FOR CLARITY</small>
      </section>
      <section className="auth-form">
        <div className="auth-card">
          <div className="tag">A BETTER WAY TO BILL</div>
          <h2>
            {totp
              ? "Verify your identity"
              : mode === "register"
                ? "Create your account"
                : mode === "reset"
                  ? token
                    ? "Set a new password"
                    : "Reset your password"
                  : "Welcome back"}
          </h2>
          <p>
            {totp
              ? "Enter the six-digit code from your authenticator."
              : mode === "login"
                ? "Sign in to your Brightloop workspace."
                : mode === "register"
                  ? "Your subscription journey starts here."
                  : "We’ll help you get back into your account."}
          </p>
          {message && mode === "login" && <div role="status" className="success">{message}</div>}
          {message && mode !== "login" ? (
            <div role="status" className="success">
              {message}
            </div>
          ) : (
            <Form
              key={`${mode}:${totp}:${demoEmail}`}
              fields={
                totp
                  ? [
                      {
                        name: "code",
                        label: "Authenticator code",
                        autoComplete: "one-time-code",
                        required: true,
                      },
                    ]
                  : [
                      ...(mode === "register"
                        ? [{ name: "name", label: "Full name", required: true }]
                        : []),
                      ...(!token
                        ? [
                            {
                              name: "email",
                              label: "Email address",
                              type: "email",
                              initial: demoEmail,
                              autoComplete: "username",
                              required: true,
                            },
                          ]
                        : []),
                      ...(mode !== "reset" || token
                        ? [
                            {
                              name: "password",
                              label: "Password",
                              type: "password",
                              autoComplete: mode === "login" ? "current-password" : "new-password",
                              required: true,
                              hint:
                                mode === "register" || token
                                  ? "9+ characters, uppercase, lowercase and a special character. Production requires 14+."
                                  : undefined,
                            },
                          ]
                        : []),
                    ]
              }
              onSubmit={(v) => void submit(v)}
              pending={pending}
              pendingLabel={totp ? "Verifying…" : mode === "login" ? "Signing in…" : "Please wait…"}
              error={error}
              submit={
                totp
                  ? "Verify and continue"
                  : mode === "register"
                    ? "Create account"
                    : mode === "reset"
                      ? "Continue"
                      : "Sign in to workspace"
              }
            />
          )}
          {verificationEmail && <button type="button" className="button secondary" disabled={pending} onClick={() => void resendVerification()}>Resend verification email</button>}
          {import.meta.env.DEV && mode === "login" && !totp && (
            <details className="demo-login-helper">
              <summary>Development demo accounts</summary>
              <p>Select a role to fill its email. Open the local demo login file for the temporary password. Admin and Finance also require an authenticator code.</p>
              <div className="demo-role-buttons">
                {["Admin", "Customer", "Sales", "Finance", "Support"].map((role) => <button type="button" className="button secondary" key={role} disabled={pending} onClick={() => { setDemoEmail(`${role.toLowerCase()}@brightloop.demo`); setError(undefined); }}>{role}</button>)}
              </div>
            </details>
          )}
          <ErrorBox error={message ? error : undefined} />
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <Link to="/reset">Forgot password?</Link>
                <span>
                  New here? <Link to="/register">Create an account</Link>
                </span>
              </>
            ) : (
              <Link to="/login">Back to sign in</Link>
            )}
          </div>
          <div className="security-note">
            <ShieldCheck size={16} />
            Secure sessions · Role-based access
          </div>
        </div>
      </section>
    </main>
  );
}

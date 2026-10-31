import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Layers3, ShieldCheck } from "lucide-react";
import { authClient } from "./api";
import { ErrorBox, Form } from "./components";
export function AuthPage({
  mode = "login",
  done,
}: {
  mode?: "login" | "register" | "reset";
  done: () => void;
}) {
  const [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false),
    [totp, setTotp] = useState(false);
  const nav = useNavigate();
  const token = new URLSearchParams(location.search).get("token");
  async function submit(v: Record<string, string>) {
    setError(undefined);
    setPending(true);
    try {
      if (totp) {
        const r = await authClient.twoFactor.verifyTotp({ code: v.code! });
        if (r.error) throw new Error(r.error.message);
        done();
        nav("/");
      } else if (mode === "register") {
        const r = await authClient.signUp.email({
          name: v.name!,
          email: v.email!,
          password: v.password!,
          callbackURL: `${location.origin}/`,
        });
        if (r.error) throw new Error(r.error.message);
        setMessage(
          "Check your verification email. Local development emails appear in .local/mail when the worker runs.",
        );
      } else if (mode === "reset") {
        const r = token
          ? await authClient.resetPassword({ newPassword: v.password!, token })
          : await authClient.requestPasswordReset({
              email: v.email!,
              redirectTo: `${location.origin}/reset`,
            });
        if (r.error) throw new Error(r.error.message);
        if (token) {
          history.replaceState({}, "", "/reset");
          setMessage("Password updated. Sign in with your new password.");
        } else
          setMessage(
            "If this account exists, a password reset email has been queued.",
          );
      } else {
        const r = await authClient.signIn.email({
          email: v.email!,
          password: v.password!,
        });
        if (r.error)
          throw new Error(
            "Sign-in failed. Check your credentials and email verification.",
          );
        if ("twoFactorRedirect" in (r.data ?? {})) setTotp(true);
        else {
          done();
          nav("/");
        }
      }
    } catch (e) {
      setError(e);
    } finally {
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
          {message ? (
            <div role="status" className="success">
              {message}
            </div>
          ) : (
            <Form
              key={`${mode}:${totp}`}
              fields={
                totp
                  ? [
                      {
                        name: "code",
                        label: "Authenticator code",
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

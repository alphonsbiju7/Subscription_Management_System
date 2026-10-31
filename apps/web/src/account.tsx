import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, KeyRound, Monitor, Mail } from "lucide-react";
import { api, authClient, fmtDate, type RecordData, type User } from "./api";
import { Badge, ErrorBox, Form, Loading, Table } from "./components";
export function Account({
  user,
  toast,
}: {
  user: User;
  toast: (v: string) => void;
}) {
  const qc = useQueryClient(),
    [setup, setSetup] = useState<{
      totpURI: string;
      backupCodes: string[];
    } | null>(null);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const r = await authClient.listSessions();
      if (r.error) throw new Error(r.error.message);
      return r.data;
    },
  });
  const mutation = useMutation({
    mutationFn: async (v: { kind: string; values: Record<string, string> }) => {
      if (v.kind === "enable") {
        const r = await authClient.twoFactor.enable({
          password: v.values.password!,
        });
        if (r.error) throw new Error(r.error.message);
        setSetup(r.data as { totpURI: string; backupCodes: string[] });
        return;
      }
      if (v.kind === "verify") {
        const r = await authClient.twoFactor.verifyTotp({
          code: v.values.code!,
        });
        if (r.error) throw new Error(r.error.message);
        return;
      }
      if (v.kind === "password") {
        const r = await authClient.changePassword({
          currentPassword: v.values.current!,
          newPassword: v.values.next!,
          revokeOtherSessions: true,
        });
        if (r.error) throw new Error(r.error.message);
        return;
      }
      if (v.kind === "revoke") {
        const r = await authClient.revokeSession({ token: v.values.token! });
        if (r.error) throw new Error(r.error.message);
        return;
      }
      if (v.kind === "profile") {
        if (user.customerId)
          await api(`/customers/${user.customerId}`, v.values, "PATCH");
        const r = await authClient.updateUser({ name: v.values.name });
        if (r.error) throw new Error(r.error.message);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast("Account security updated");
    },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1>Profile & security</h1>
          <p>Protect your account and manage your active sessions.</p>
        </div>
        <Badge>{user.role}</Badge>
      </div>
      {user.requiresMfa && (
        <div className="notice">
          <ShieldCheck size={20} />
          <div>
            <strong>MFA enrollment required</strong>
            <p>
              Administrator and finance access requires a verified
              authenticator. Enroll below, then verify a code to enter your
              workspace.
            </p>
          </div>
        </div>
      )}
      <ErrorBox error={mutation.error} />
      <div className="detail-grid">
        <section className="panel detail-body">
          <h2>
            <ShieldCheck size={20} />
            Two-factor authentication
          </h2>
          <p className="muted">
            Use a TOTP authenticator. Keep your recovery codes somewhere secure.
          </p>
          {user.twoFactorEnabled ? (
            <div className="success">
              Authenticator verified and enforced at sign-in.
            </div>
          ) : setup ? (
            <>
              <div className="totp-setup">
                <label>
                  Authenticator setup key
                  <code>
                    {new URL(setup.totpURI).searchParams.get("secret")}
                  </code>
                </label>
                <p>
                  In your authenticator, add an account with this key. Choose
                  time-based codes.
                </p>
                <details>
                  <summary>Recovery codes — save these now</summary>
                  <pre>{setup.backupCodes.join("\n")}</pre>
                </details>
              </div>
              <Form
                fields={[
                  {
                    name: "code",
                    label: "Six-digit authenticator code",
                    required: true,
                  },
                ]}
                submit="Verify authenticator"
                onSubmit={(values) =>
                  mutation.mutate({ kind: "verify", values })
                }
                pending={mutation.isPending}
              />
            </>
          ) : (
            <Form
              fields={[
                {
                  name: "password",
                  label: "Current password",
                  type: "password",
                  required: true,
                },
              ]}
              submit="Set up authenticator"
              onSubmit={(values) => mutation.mutate({ kind: "enable", values })}
              pending={mutation.isPending}
            />
          )}
        </section>
        <section className="panel detail-body">
          <h2>
            <KeyRound size={20} />
            Change password
          </h2>
          <Form
            fields={[
              {
                name: "current",
                label: "Current password",
                type: "password",
                required: true,
              },
              {
                name: "next",
                label: "New password",
                type: "password",
                required: true,
                hint: "9+ characters with uppercase, lowercase and a special character. Production: 14+.",
              },
            ]}
            submit="Update password"
            onSubmit={(values) => mutation.mutate({ kind: "password", values })}
            pending={mutation.isPending}
          />
        </section>
      </div>
      <section className="panel secondary-panel">
        <div className="panel-title">
          <h2>
            <Monitor size={20} />
            Active sessions
          </h2>
        </div>
        {sessions.isPending ? (
          <Loading />
        ) : sessions.error ? (
          <ErrorBox error={sessions.error} />
        ) : (
          <Table
            items={(sessions.data ?? []) as unknown as RecordData[]}
            columns={[
              { key: "ipAddress", label: "IP address" },
              { key: "userAgent", label: "Device / browser" },
              {
                key: "createdAt",
                label: "Signed in",
                render: (r) => fmtDate(r.createdAt),
              },
              {
                key: "expiresAt",
                label: "Expires",
                render: (r) => fmtDate(r.expiresAt),
              },
            ]}
            actions={(r) => (
              <button
                className="table-button"
                onClick={() => {
                  if (
                    confirm(
                      "Revoke this session? Revoking your current session will sign you out.",
                    )
                  )
                    mutation.mutate({
                      kind: "revoke",
                      values: { token: String(r.token) },
                    });
                }}
              >
                Revoke
              </button>
            )}
          />
        )}
      </section>
      <section className="panel detail-body secondary-panel">
        <h2>
          <Mail size={20} />
          Customer profile
        </h2>
        <p>{user.email}</p>
        <Form
          key={user.id}
          fields={[
            { name: "name", label: "Name", required: true, initial: user.name },
            ...(user.customerId
              ? [
                  {
                    name: "company",
                    label: "Company",
                    initial: String(user.customer?.company ?? ""),
                  },
                  {
                    name: "phone",
                    label: "Phone",
                    initial: String(user.customer?.phone ?? ""),
                  },
                  {
                    name: "billingAddress",
                    label: "Billing address",
                    type: "textarea",
                    initial: String(user.customer?.billingAddress ?? ""),
                  },
                ]
              : []),
          ]}
          submit="Save profile"
          pending={mutation.isPending}
          onSubmit={(values) => mutation.mutate({ kind: "profile", values })}
        />
      </section>
    </>
  );
}
export function Settings({ toast }: { toast: (v: string) => void }) {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{ items: RecordData[]; integrations: Record<string, string> }>(
        "/settings",
      ),
  });
  const mutation = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api(
        "/settings",
        {
          ...v,
          graceDays: Number(v.graceDays),
          reminderDays: v.reminderDays!.split(",").map(Number),
          renewalNoticeDays: Number(v.renewalNoticeDays),
        },
        "PUT",
      ),
    onSuccess: () => toast("Business settings saved"),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const business = (q.data.items.find((i) => i.key === "business")?.value ??
    {}) as Record<string, unknown>;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ORGANIZATION</span>
          <h1>Settings & integrations</h1>
          <p>Configure Brightloop’s collections and reminder policies.</p>
        </div>
      </div>
      <div className="detail-grid">
        <section className="panel detail-body">
          <h2>Business & reminder policy</h2>
          <Form
            fields={[
              {
                name: "companyName",
                label: "Company name",
                initial: String(business.companyName ?? "Brightloop Software"),
                required: true,
              },
              {
                name: "supportEmail",
                label: "Support email",
                type: "email",
                initial: String(
                  business.supportEmail ?? "support@brightloop.local",
                ),
                required: true,
              },
              {
                name: "graceDays",
                label: "Past-due grace period (days)",
                type: "number",
                initial: String(business.graceDays ?? 14),
                required: true,
              },
              {
                name: "reminderDays",
                label: "Reminder offsets (days, comma separated)",
                initial: String(business.reminderDays ?? "1,3,7,14"),
                required: true,
              },
              {
                name: "renewalNoticeDays",
                label: "Renewal notice days",
                type: "number",
                initial: String(business.renewalNoticeDays ?? 7),
                required: true,
              },
            ]}
            onSubmit={(v) => mutation.mutate(v)}
            pending={mutation.isPending}
            error={mutation.error}
          />
        </section>
        <section className="panel detail-body">
          <h2>Integration status</h2>
          {Object.entries(q.data.integrations).map(([name, status]) => (
            <div className="integration-row" key={name}>
              <strong>{name}</strong>
              <p>{status}</p>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
export function Invite({ toast }: { toast: (v: string) => void }) {
  const mutation = useMutation({
    mutationFn: (v: Record<string, string>) => api("/me/accept-invite", v),
    onSuccess: () => {
      history.replaceState({}, "", "/invite");
      toast("Invitation accepted. Sign in again to use your new role.");
      location.assign("/login");
    },
  });
  return (
    <section className="panel detail-body">
      <h1>Accept team invitation</h1>
      <p>
        Sign in with the verified email address to which the invitation was
        sent.
      </p>
      <Form
        fields={[
          {
            name: "token",
            label: "Invitation token",
            initial: location.hash.slice(1),
            required: true,
          },
        ]}
        onSubmit={(v) => mutation.mutate(v)}
        pending={mutation.isPending}
        error={mutation.error}
        submit="Accept invitation"
      />
    </section>
  );
}

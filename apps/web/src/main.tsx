import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Package,
  Layers3,
  FileText,
  Repeat2,
  Receipt,
  Wallet,
  ChartNoAxesCombined,
  ShieldCheck,
  Settings2,
  Activity,
  Bell,
  UserRoundCog,
  LogOut,
  Menu,
  X,
  CircleHelp,
  ChevronRight,
  Tag,
  Percent,
  ScrollText,
  Gauge,
  CreditCard,
  PanelLeftClose,
} from "lucide-react";
import { api, authClient, type User } from "./api";
import { AuthPage } from "./auth";
import { Account, Settings, Invite } from "./account";
import { Dashboard } from "./dashboard";
import { ResourcePage, DetailPage, resources } from "./resources";
import { Loading } from "./components";
import "./styles.css";
import "./readability.css";
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
  },
});
const all = ["ADMIN", "SALES", "FINANCE", "SUPPORT", "CUSTOMER"];
const navigation = [
  {
    group: "WORKSPACE",
    items: [
      { path: "/", label: "Overview", icon: LayoutDashboard, roles: all },
      {
        path: "/customers",
        label: "Customers",
        icon: Users,
        roles: ["ADMIN", "SALES", "FINANCE", "SUPPORT"],
      },
      {
        path: "/products",
        label: "Product catalog",
        icon: Package,
        roles: all,
      },
      { path: "/plans", label: "Plans & pricing", icon: Layers3, roles: all },
      {
        path: "/quotes",
        label: "Quotations",
        icon: FileText,
        roles: ["ADMIN", "SALES", "CUSTOMER"],
      },
      {
        path: "/subscriptions",
        label: "Subscriptions",
        icon: Repeat2,
        roles: all,
      },
    ],
  },
  {
    group: "REVENUE OPERATIONS",
    items: [
      { path: "/invoices", label: "Invoices", icon: Receipt, roles: all },
      { path: "/payments", label: "Payments", icon: Wallet, roles: all },
      {
        path: "/credits",
        label: "Credits & refunds",
        icon: CreditCard,
        roles: ["ADMIN", "FINANCE", "SUPPORT", "CUSTOMER"],
      },
      {
        path: "/usage",
        label: "Usage & entitlements",
        icon: Gauge,
        roles: ["ADMIN", "FINANCE", "CUSTOMER"],
      },
      {
        path: "/reports",
        label: "Reports",
        icon: ChartNoAxesCombined,
        roles: ["ADMIN", "FINANCE", "CUSTOMER"],
      },
      {
        path: "/integrity",
        label: "ProofBill",
        icon: ShieldCheck,
        roles: ["ADMIN", "FINANCE"],
      },
      {
        path: "/billing",
        label: "Billing operations",
        icon: Activity,
        roles: ["ADMIN", "FINANCE"],
      },
    ],
  },
  {
    group: "CONFIGURATION",
    items: [
      {
        path: "/taxes",
        label: "Tax rules",
        icon: Percent,
        roles: ["ADMIN", "FINANCE"],
      },
      {
        path: "/discounts",
        label: "Discounts",
        icon: Tag,
        roles: ["ADMIN", "FINANCE", "SALES"],
      },
      {
        path: "/quote-templates",
        label: "Quote templates",
        icon: ScrollText,
        roles: ["ADMIN", "SALES"],
      },
      {
        path: "/notifications",
        label: "Notifications",
        icon: Bell,
        roles: all,
      },
      { path: "/staff", label: "Team & access", icon: Users, roles: ["ADMIN"] },
      {
        path: "/audit",
        label: "Audit trail",
        icon: UserRoundCog,
        roles: ["ADMIN", "FINANCE"],
      },
      {
        path: "/settings",
        label: "Settings",
        icon: Settings2,
        roles: ["ADMIN"],
      },
    ],
  },
];
function Workspace() {
  const [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(""),
    location = useLocation();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/me") });
  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(""), 5000);
  };
  function onAuth() {
    void client.invalidateQueries();
  }
  const authMode =
    location.pathname === "/register"
      ? "register"
      : location.pathname === "/reset"
        ? "reset"
        : "login";
  if (["/login", "/register", "/reset"].includes(location.pathname))
    return <AuthPage mode={authMode} done={onAuth} />;
  if (me.isPending) return <Loading />;
  if (!me.data) return <AuthPage done={onAuth} />;
  const user = me.data,
    section = location.pathname.split("/")[1] ?? "",
    current =
      navigation.flatMap((g) => g.items).find((i) => i.path === `/${section}`)
        ?.label ?? "Overview";
  return (
    <div className="app-layout">
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <Link to="/" className="brand" onClick={() => setMobile(false)}>
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>
          brightloop<span className="brand-period">.</span>
        </Link>
        <div className="workspace-switch">
          <span className="workspace-avatar">B</span>
          <div>
            <strong>Brightloop Software</strong>
            <small>Subscription workspace</small>
          </div>
          <PanelLeftClose size={15} />
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.group}>
              <span className="nav-label">{group.group}</span>
              {group.items
                .filter((item) => item.roles.includes(user.role))
                .map((item) => (
                  <NavLink
                    key={item.path}
                    aria-label={item.label}
                    to={item.path}
                    end={item.path === "/"}
                    onClick={() => setMobile(false)}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                    {item.label === "ProofBill" && (
                      <span className="nav-new">VERIFY</span>
                    )}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/account">
            <CircleHelp size={17} />
            <span>Account & security</span>
            <ChevronRight size={15} />
          </Link>
          <div className="version">
            SUBSCRIPTION OS <span>v0.1</span>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X size={21} /> : <Menu size={21} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{current}</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-badge">
              <i />
              Brightloop Software
            </span>
            <Link
              className="icon-button"
              to="/notifications"
              aria-label="Notifications"
            >
              <Bell size={19} />
            </Link>
            <span className="topbar-divider" />
            <Link className="user-control" to="/account">
              <span className="user-avatar">
                {user.name
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role.toLowerCase()}</small>
              </span>
            </Link>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => {
                void authClient.signOut().then(() => {
                  client.clear();
                  locationAssign("/login");
                });
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {user.requiresMfa ? (
            <Account user={user} toast={notify} />
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard user={user} />} />
              <Route
                path="/reports"
                element={<Dashboard user={user} report />}
              />
              <Route
                path="/account"
                element={<Account user={user} toast={notify} />}
              />
              <Route path="/invite" element={<Invite toast={notify} />} />
              <Route
                path="/settings"
                element={
                  user.role === "ADMIN" ? (
                    <Settings toast={notify} />
                  ) : (
                    <p>Administrator access required.</p>
                  )
                }
              />
              {Object.keys(resources).map((resource) => (
                <React.Fragment key={resource}>
                  <Route
                    path={`/${resource}`}
                    element={
                      <ResourcePage
                        key={resource}
                        resource={resource}
                        user={user}
                        toast={notify}
                      />
                    }
                  />
                  <Route
                    path={`/${resource}/:id`}
                    element={
                      <DetailPage
                        key={resource}
                        resource={resource}
                        user={user}
                        toast={notify}
                      />
                    }
                  />
                </React.Fragment>
              ))}
              <Route
                path="*"
                element={
                  <section className="empty">
                    <h1>Page not found</h1>
                    <Link to="/">Return to your workspace</Link>
                  </section>
                }
              />
            </Routes>
          )}
          <footer className="page-footer">
            <span>Brightloop SubscriptionOS</span>
            <span>Connected operations. Clearer revenue.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function locationAssign(path: string) {
  window.location.assign(path);
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Workspace />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

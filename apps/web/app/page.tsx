import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { CodeExample } from "@/components/code-example";

const github = "https://github.com/clipinfit/convex-plunk";
export default function Home() {
  return (
    <div className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Mail size={18} />
          </span>
          convex-plunk
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/docs">Docs</Link>
          <a href={github}>
            GitHub <ArrowUpRight size={14} />
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">OPEN SOURCE / CONVEX + PLUNK</p>
            <h1>
              Your app.
              <br />
              Your emails.
              <br />
              <em>One queue.</em>
            </h1>
            <p className="hero-description">
              Queue email in Convex. Deliver with Plunk. Keep the schedule,
              message status, and recipient restrictions in your backend.
            </p>
            <div className="hero-actions">
              <Link href="/docs/getting-started" className="button primary">
                Get started <ArrowRight size={17} />
              </Link>
              <Link href="/docs" className="button secondary">
                Read the docs <ArrowRight size={17} />
              </Link>
            </div>
            <p className="availability">Your templates. Your sending domain.</p>
          </div>
          <figure
            className="queue-illustration"
            aria-label="Illustration of an email queue. These are sample states, not live delivery data."
          >
            <figcaption className="preview-label">
              YOUR CONVEX BACKEND <span>ILLUSTRATION</span>
            </figcaption>
            <div className="queue-card">
              <div className="queue-title">
                <span className="queue-logo">
                  <Mail size={22} />
                </span>
                <div>
                  <strong>Outgoing mail</strong>
                  <small>Every message has a record.</small>
                </div>
                <span className="queue-count">03</span>
              </div>
              <div className="queue-columns">
                <span>MESSAGE</span>
                <span>STATUS</span>
              </div>
              <div className="queue-row">
                <span className="message-icon">
                  <Check size={17} />
                </span>
                <div>
                  <strong>Welcome aboard</strong>
                  <small>welcome:user-123:v1</small>
                </div>
                <span className="status accepted">Accepted</span>
              </div>
              <div className="queue-row">
                <span className="message-icon">
                  <Clock3 size={17} />
                </span>
                <div>
                  <strong>Your reminder</strong>
                  <small>Scheduled in Convex</small>
                </div>
                <span className="status queued">Queued</span>
              </div>
              <div className="queue-row">
                <span className="message-icon">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <strong>Account update</strong>
                  <small>Recipient is blocked</small>
                </div>
                <span className="status suppressed">Suppressed</span>
              </div>
              <div className="queue-footer">
                <ShieldCheck size={14} />
                Recipient restrictions checked before sending
              </div>
            </div>
            <div className="delivery-path">
              <span>CONVEX</span>
              <span className="path-line" />
              <span className="provider">
                Plunk <ArrowUpRight size={13} />
              </span>
            </div>
            <p className="illustration-note">
              Accepted means the provider accepted the message.
              <br />
              Delivery requires a separate confirmation.
            </p>
          </figure>
        </section>
        <div className="principles-strip">
          <span>Apache-2.0</span>
          <span>Persistent queue</span>
          <span>React Email compatible</span>
          <span>Test mode by default</span>
        </div>
        <section className="build-section" id="integration">
          <div>
            <p className="eyebrow">A COMPONENT IN YOUR BACKEND</p>
            <h2>
              Write the email.
              <br />
              Keep the record.
            </h2>
            <p>
              Mount the component, define a worker, and queue HTML from your
              Convex functions. Give each business event a stable key to prevent
              duplicate queue entries.
            </p>
            <p>
              Keep your React Email templates and local preview workflow. Pass
              the rendered HTML to the component.
            </p>
            <Link href="/docs/react-email" className="text-link">
              Use React Email <ArrowRight size={15} />
            </Link>
          </div>
          <CodeExample />
        </section>
        <section className="responsibilities">
          <div className="section-heading">
            <p className="eyebrow">DELIVERY NEEDS MORE THAN A SEND CALL</p>
            <h2>A place for the details.</h2>
          </div>
          <div className="responsibility-grid">
            <article>
              <span className="number">01 / TIMING</span>
              <h3>Send on your schedule.</h3>
              <p>
                Choose a future timestamp. Convex keeps the job and runs the
                worker. Cancel a message while it is still queued.
              </p>
              <Link href="/docs/scheduling">
                Scheduling and cancellation <ArrowRight size={15} />
              </Link>
            </article>
            <article>
              <span className="number">02 / RECIPIENTS</span>
              <h3>Preserve the opt-out.</h3>
              <p>
                Import existing restrictions. Block hard bounces and complaints.
                Keep marketing opt-outs separate from essential transactional
                email.
              </p>
              <Link href="/docs/suppression">
                Consent and suppression <ArrowRight size={15} />
              </Link>
            </article>
            <article>
              <span className="number">03 / OUTCOMES</span>
              <h3>Know when to inspect.</h3>
              <p>
                Rate limits get bounded retries. Ambiguous outcomes stop for
                review, because a timeout does not prove that an email was never
                sent.
              </p>
              <Link href="/docs/delivery">
                Delivery and retries <ArrowRight size={15} />
              </Link>
            </article>
          </div>
        </section>
        <section className="start-section">
          <div>
            <p className="eyebrow">OPEN SOURCE / APACHE-2.0</p>
            <h2>
              Make email part
              <br />
              of your app.
            </h2>
            <p>
              Start with the local example, connect your Plunk project, and
              queue your first message from Convex.
            </p>
          </div>
          <Link href="/docs/getting-started" className="button secondary">
            Get started <ArrowRight size={17} />
          </Link>
        </section>
      </main>
      <footer>
        <Link href="/" className="brand">
          <Mail size={18} />
          convex-plunk
        </Link>
        <span>By Clipin · Apache-2.0</span>
        <div>
          <Link href="/docs">Documentation</Link>
          <a href={github}>
            GitHub <ArrowUpRight size={13} />
          </a>
        </div>
        <p className="footer-note">
          Independent component. Not an official Convex or Plunk product.
        </p>
      </footer>
    </div>
  );
}

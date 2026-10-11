import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { BRAND } from '../config/brand'
import { CONNECT_HOSTS, buildCsp, HEADER_ONLY } from '../config/csp'
import { H2, PageLayout, code } from './PageLayout'

function Security() {
  return (
    <PageLayout
      title="Security & privacy"
      intro={<>{BRAND.name} has no server, no accounts, no analytics and no third-party scripts. Everything happens in your browser. This page explains exactly where your data lives, where every request goes, and how to check that for yourself.</>}
    >
      <section className="callout">
        <h2 className="text-lg font-semibold text-white">The cautious option: run it on your own machine</h2>
        <p className="mt-2">If you'd rather not trust any hosted copy (including this one), run the same code locally. It's identical to what's deployed, and you can read every line first.</p>
        <pre>{`git clone ${BRAND.repoUrl}.git
cd ${BRAND.repoUrl.split('/').pop()}
npm install
npm run dev        # then open http://localhost:5173`}</pre>
        <p className="mt-2 text-sm">For a production build served from your own machine: <code>npm run build &amp;&amp; npm run preview</code> (this also applies the strict Content Security Policy).</p>
      </section>

      <section className="space-y-3">
        <H2 id="storage">Where your data is stored</H2>
        <table>
          <thead><tr><th>What</th><th>Where</th><th>Leaves your device?</th></tr></thead>
          <tbody>
            <tr><td>Projects, areas, processed imagery, stats, notes, annotations</td><td>IndexedDB in this browser</td><td>Only if you export a project file or report and send it to someone</td></tr>
            <tr><td>AI API keys (default)</td><td>Memory only; gone when the tab closes or reloads</td><td>Sent only to that provider's API</td></tr>
            <tr><td>AI API keys (if you tick "Remember on this device")</td><td>localStorage in this browser profile</td><td>Sent only to that provider's API</td></tr>
            <tr><td>AI conversations</td><td>Memory only; never written to disk</td><td>Sent to the provider you chose</td></tr>
            <tr><td>Ollama URL, small UI preferences</td><td>localStorage</td><td>No</td></tr>
          </tbody>
        </table>
        <p>Deleting an area or project removes its data immediately. To wipe everything, clear this site's data in your browser settings.</p>
        <p>Key handling code: <a href={code('src/ai/keys.ts')}>src/ai/keys.ts</a>. Provider calls: <a href={code('src/ai/providers')}>src/ai/providers/</a>.</p>
      </section>

      <section className="space-y-3">
        <H2 id="requests">Where every request goes</H2>
        <p>The browser is only allowed to contact the hosts below. This is enforced by a strict Content Security Policy, so even a bug couldn't send data elsewhere.</p>
        <table>
          <thead><tr><th>Purpose</th><th>Hosts</th></tr></thead>
          <tbody>
            {CONNECT_HOSTS.map((g) => (
              <tr key={g.purpose}><td>{g.purpose}</td><td>{g.hosts.map((h) => <div key={h}><code>{h}</code></div>)}</td></tr>
            ))}
          </tbody>
        </table>
        <ul>
          <li><b>Imagery requests</b> download public satellite data. They reveal the map extent you're looking at to those archives (Element84/AWS and Microsoft), as any map viewer would.</li>
          <li><b>Place search</b> sends your search text to Photon (komoot). It's only sent when you press Enter, not on every keystroke.</li>
          <li><b>AI providers</b> are contacted only after you add a key (or set up Ollama) and send a message. They receive your project summary and any images the model asks for. Anthropic is called with its official SDK in browser mode, which sends the <code>anthropic-dangerous-direct-browser-access</code> header.</li>
          <li><b>The MCP server</b> (optional, for AI agents) is a separate program you run on your own computer from the source code. It contacts the same imagery archives and Photon listed above, saves projects as files in <code>~/.satlapse/mcp</code>, and is never loaded by this website.</li>
          <li><b>Share links</b> put only the project name and area outlines after the <code>#</code> in the URL. Browsers never send that part to a server.</li>
          <li>There are no analytics, trackers, ads, cookies or third-party scripts.</li>
        </ul>
        <p>The policy lives in one file: <a href={code('src/config/csp.ts')}>src/config/csp.ts</a>. The full policy in force:</p>
        <pre className="whitespace-pre-wrap break-all">{`${buildCsp()}; ${HEADER_ONLY}`}</pre>
      </section>

      <section className="space-y-3">
        <H2 id="verify">How to verify this yourself</H2>
        <ol>
          <li>Open your browser's developer tools (F12) and go to the <b>Network</b> tab. Use the app and watch every request: each goes to a host in the table above.</li>
          <li>Check the <b>Content-Security-Policy</b> response header on the page (Network tab → the document request → Headers). Try <code>fetch('https://example.com')</code> in the Console: the browser blocks it.</li>
          <li>Look in <b>Application → Storage</b> to see exactly what's stored in IndexedDB and localStorage.</li>
          <li>Read the code (it's short), or run it locally from source as shown above.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <H2 id="keys">Using your own AI key safely</H2>
        <p>Keys used directly from a browser are visible to anything running in that browser profile (for example a malicious extension). Treat them accordingly:</p>
        <ul>
          <li><b>Create a dedicated key</b> just for {BRAND.name}, so you can revoke it without affecting anything else.</li>
          <li><b>Set a low spend limit.</b> Anthropic: create a separate workspace with a monthly spend limit in the Console. OpenAI: put the key in its own project with a budget. OpenRouter: set a credit limit on the key. Google AI Studio: use a separate project and keep it on free-tier limits or set a budget alert.</li>
          <li>Leave "Remember on this device" off on shared or work computers. The default keeps the key in memory for this tab only.</li>
          <li>Prefer <b>Ollama</b> (fully local) or <b>Copy to AI</b> (no key at all) if you'd rather not use a key in the browser.</li>
        </ul>
        <p>Ollama: the browser can only reach it if it allows this site's origin. Start it with <code>OLLAMA_ORIGINS={BRAND.siteUrl} ollama serve</code> (or <code>http://localhost:5173</code> when running locally). Only <code>localhost</code> and <code>127.0.0.1</code> are permitted by the policy.</p>
      </section>

      <section className="space-y-3">
        <H2 id="report">Reporting a security issue</H2>
        <p>Please use a private security advisory on <a href={`${BRAND.repoUrl}/security/advisories/new`}>GitHub</a> rather than a public issue.</p>
      </section>
    </PageLayout>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Security /></StrictMode>)

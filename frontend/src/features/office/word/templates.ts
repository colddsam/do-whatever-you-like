/** Starter documents for the Word editor. */
import { DEFAULT_PAGE, type WordDoc } from "./model";

const page = (p: Partial<WordDoc["page"]> = {}) => ({ ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins }, ...p });
const today = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export const WORD_TEMPLATES: { id: string; name: string; description: string; build: () => WordDoc }[] = [
  { id: "blank", name: "Blank document", description: "Start from scratch", build: () => ({ html: "<p><br></p>", page: page() }) },
  {
    id: "resume",
    name: "Resume",
    description: "Clean one-page CV",
    build: () => ({
      page: page({ margins: { top: 15, right: 18, bottom: 15, left: 18 } }),
      html: `<h1 class="doc-title">Your Name</h1><p class="doc-subtitle">Product Designer · City, Country · you@example.com · +1 555 0100</p><h2>Profile</h2><p>Designer with 6 years of experience turning complex problems into simple, accessible products. Comfortable from research to shipped code.</p><h2>Experience</h2><h3>Senior Designer — Company A</h3><p style="color:#595959">2022 – present</p><ul><li>Led the redesign of the onboarding flow, lifting activation by 18%.</li><li>Built and maintained the design system used by 40 engineers.</li></ul><h3>Designer — Company B</h3><p style="color:#595959">2019 – 2022</p><ul><li>Shipped the mobile app's checkout, cutting drop-off by a third.</li></ul><h2>Education</h2><p><b>BA in Design</b>, University Name — 2019</p><h2>Skills</h2><p>Figma · Prototyping · User research · HTML &amp; CSS · Accessibility</p>`,
    }),
  },
  {
    id: "letter",
    name: "Cover letter",
    description: "A formal letter with your details",
    build: () => ({
      page: page(),
      html: `<p style="text-align:right">Your Name<br>Street, City<br>you@example.com</p><p>${today()}</p><p>Hiring Manager<br>Company Name<br>Street, City</p><p>Dear Hiring Manager,</p><p>I'm writing to apply for the role of <b>Job Title</b>. With experience in … I believe I can help your team …</p><p>In my current role at … I …</p><p>Thank you for your time. I'd welcome the chance to talk about how I can contribute.</p><p>Sincerely,</p><p>Your Name</p>`,
    }),
  },
  {
    id: "report",
    name: "Report",
    description: "Title, contents and sections",
    build: () => ({
      page: page({ footer: "Company · Confidential", pageNumbers: "bottom-right" }),
      html: `<h1 class="doc-title">Annual Report 2026</h1><p class="doc-subtitle">Prepared by the Strategy Team · ${today()}</p><div class="toc" contenteditable="false"><p><b>Contents</b></p></div><h1 id="h-summary">Executive summary</h1><p>Summarise the key findings here in two or three sentences.</p><h1 id="h-results">Results</h1><h2 id="h-revenue">Revenue</h2><p>Revenue grew across all regions.</p><table><tbody><tr><th>Region</th><th>2025</th><th>2026</th></tr><tr><td>North</td><td>1.2M</td><td>1.5M</td></tr><tr><td>South</td><td>0.9M</td><td>1.1M</td></tr></tbody></table><h2 id="h-customers">Customers</h2><p>Write about customers here.</p><h1 id="h-next">Next steps</h1><ol><li>First action</li><li>Second action</li></ol>`,
    }),
  },
  {
    id: "notes",
    name: "Meeting notes",
    description: "Agenda, notes and action items",
    build: () => ({
      page: page(),
      html: `<h1 class="doc-title">Meeting notes</h1><p class="doc-subtitle">${today()} · Attendees: …</p><h2>Agenda</h2><ol><li>Updates</li><li>Decisions</li><li>Next steps</li></ol><h2>Notes</h2><p>…</p><h2>Action items</h2><ul class="checklist"><li data-checked="false">Send the summary — Alex</li><li data-checked="false">Book the follow-up — Sam</li></ul>`,
    }),
  },
  {
    id: "essay",
    name: "Essay (double-spaced)",
    description: "Header block and double line spacing",
    build: () => ({
      page: page({ header: "Surname", pageNumbers: "top-right" }),
      html: `<p style="line-height:2">Your Name<br>Instructor Name<br>Course<br>${today()}</p><p style="text-align:center;line-height:2">Title of the Essay</p><p style="line-height:2;text-indent:48px">Start your introduction here. Each paragraph is indented and double-spaced, as most style guides ask.</p>`,
    }),
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "Two columns",
    build: () => ({
      page: page({ columns: 2, margins: { top: 18, right: 18, bottom: 18, left: 18 } }),
      html: `<h1 class="doc-title">The Monthly</h1><p class="doc-subtitle">News, ideas and updates</p><h2>Top story</h2><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus.</p><h2>Around the team</h2><p>Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper.</p><h2>Dates</h2><ul><li>12 — Workshop</li><li>20 — Town hall</li></ul>`,
    }),
  },
];

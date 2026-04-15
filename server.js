const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ───────────────────────────────────────────────
const CLIENT_ID = process.env.JIRA_CLIENT_ID;
const CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CALLBACK_URL = 'https://weekly-pulse.onrender.com/callback';
const FRONTEND_URL = 'https://pitchyou.netlify.app';
const CLOUD_ID = '85ac1498-4a4c-49a5-a04f-22069874b42a';

// ─── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'PitchYou backend is running' });
});

// ─── Helper: Anthropic API call ───────────────────────────
async function callAnthropic(systemPrompt, userPrompt, maxTokens = 1000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

// ─── POST /generate ───────────────────────────────────────
app.post('/generate', async (req, res) => {
  const { userType, box1, box2, confidenceBoost } = req.body;

  if (!box1 || !box1.trim()) {
    return res.status(400).json({ error: 'box1 is required' });
  }

  const confidenceNote = confidenceBoost
    ? 'The person wants a confident, assertive tone. Make everything stronger and more direct.'
    : '';

  const systemPrompt = `You generate sharp personal pitch content. Follow these rules exactly:
- Sound like a human talking to a human. Never like a brand.
- Start with value, not "I am a" or "Hi my name is"
- Convert tasks into outcomes: "I manage projects" becomes "I help teams finish on time"
- Use their specific details. Vague kills pitches.
- Never use: passionate, innovative, game-changing, leverage, synergy, driven, dynamic, dedicated, results-oriented, world-class
- Never use em dashes. Use a period instead.
- No bullet points inside pitch text
- Short sentences beat long ones
- Try to extract the person's first name from the input. If you cannot find one, return null for the name field.
${confidenceNote}

Return ONLY valid JSON. No markdown fences. No explanation. No preamble.`;

  const userPrompt = `Person type: ${userType || 'Professional'}

What they do and who they help:
${box1}

${box2 ? `Results or experience:\n${box2}` : 'No additional context provided.'}

Generate this exact JSON structure:
{
  "name": "their first name if found in the input, otherwise null",
  "headline": "one punchy line under 10 words that captures who they are",
  "mainPitch": "1-4 sentences. Starts with value. Specific. No buzzwords.",
  "bio": "2-3 sentences. Third person. Professional but human.",
  "qaContext": [
    {"q": "realistic question a visitor would ask", "a": "answer in their voice, first person, 2-3 sentences, confident"},
    {"q": "...", "a": "..."},
    {"q": "...", "a": "..."},
    {"q": "...", "a": "..."},
    {"q": "...", "a": "..."}
  ]
}`;

  try {
    console.log('Generating pitch for:', userType, '| box1 length:', box1.length);

    const raw = await callAnthropic(systemPrompt, userPrompt, 1800);

    // Strip markdown fences and em dashes as safety net
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/\u2014/g, '.')
      .replace(/--/g, '.')
      .trim();

    const result = JSON.parse(cleaned);

    console.log('Pitch generated for:', result.name || '(no name found)');

    res.json({
      name: result.name || null,
      headline: result.headline,
      mainPitch: result.mainPitch,
      bio: result.bio,
      qaContext: result.qaContext || []
    });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: 'Failed to generate pitch', details: err.message });
  }
});

// ─── POST /ask ────────────────────────────────────────────
app.post('/ask', async (req, res) => {
  const { personContext, question } = req.body;

  if (!question || !personContext) {
    return res.status(400).json({ error: 'question and personContext are required' });
  }

  const { name, userType, headline, mainPitch, bio, qaContext, rawInput } = personContext;
  const displayName = name || 'this person';

  const systemPrompt = `You are answering questions on behalf of a specific person. You speak as them, in first person.
Rules:
- Use only what is provided, plus logical inference
- Never invent credentials, companies, or specific facts not in the context
- Keep answers to 2-3 sentences maximum
- Sound like someone confident answering a question at a networking event. Not a bot.
- No bullet points. No em dashes. Short sentences.
- If you truly do not know something, say so briefly and pivot to what you do know.
- Return only the answer text. No preamble. No opener like "As ${displayName}".`;

  const contextParts = [
    `About ${displayName}:`,
    `Type: ${userType || 'Professional'}`,
    `Headline: ${headline}`,
    `Main pitch: ${mainPitch}`,
    `Bio: ${bio}`,
    rawInput?.box1 ? `What they do: ${rawInput.box1}` : '',
    rawInput?.box2 ? `Background/results: ${rawInput.box2}` : '',
    qaContext?.length > 0
      ? `Additional context:\n${qaContext.map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n')}`
      : ''
  ].filter(Boolean).join('\n');

  const userPrompt = `${contextParts}

Visitor's question: ${question}

Answer in first person as ${displayName}. 2-3 sentences maximum.`;

  try {
    const raw = await callAnthropic(systemPrompt, userPrompt, 300);

    const answer = raw
      .replace(/\u2014/g, '.')
      .replace(/--/g, '.')
      .trim();

    console.log('Question answered for:', displayName);

    res.json({ answer });
  } catch (err) {
    console.error('Ask error:', err);
    res.status(500).json({ error: 'Failed to generate answer', details: err.message });
  }
});

// ─── OAuth: Step 1 — Redirect user to Atlassian ──────────
app.get('/auth', (req, res) => {
  const scopes = [
    'read:jira-work',
    'read:jira-user',
    'read:issue:jira',
    'read:project:jira',
    'read:issue-details:jira',
    'read:jql:jira',
    'read:sprint:jira-software',
    'read:board-scope:jira-software',
    'read:user:jira',
    'offline_access'
  ].join(' ');

  const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&response_type=code&prompt=consent`;

  console.log('Redirecting to Atlassian OAuth...');
  res.redirect(authUrl);
});

// ─── OAuth: Step 2 — Exchange code for token ──────────────
app.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error('No auth code received');
    return res.redirect(`${FRONTEND_URL}#error=no_code`);
  }

  try {
    console.log('Exchanging auth code for token...');

    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: CALLBACK_URL
      })
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error('Token error:', tokenData);
      return res.redirect(`${FRONTEND_URL}#error=${tokenData.error}`);
    }

    console.log('Token obtained successfully');
    console.log('Scopes granted:', tokenData.scope);

    const params = new URLSearchParams({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'Bearer'
    });

    if (tokenData.refresh_token) {
      params.append('refresh_token', tokenData.refresh_token);
    }

    res.redirect(`${FRONTEND_URL}#${params.toString()}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}#error=token_exchange_failed`);
  }
});

// ─── Helper: Extract Bearer token ─────────────────────────
function getToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.split(' ')[1];
}

// ─── Jira: Fetch issues ────────────────────────────────────
app.get('/jira/issues', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    console.log('Fetching Jira issues...');

    const jql = encodeURIComponent('project = SCRUM ORDER BY updated DESC');
    const fields = 'summary,status,description,assignee,priority,created,updated,sprint';
    const url = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/2/search?jql=${jql}&maxResults=50&fields=${fields}`;

    const issuesRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });

    const issuesData = await issuesRes.json();
    console.log('Total issues found:', issuesData.total);

    if (issuesData.total === 0) {
      console.log('Zero issues with project filter. Trying broad query...');

      const fallbackUrl = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/2/search?jql=${encodeURIComponent('ORDER BY updated DESC')}&maxResults=50&fields=${fields}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      const fallbackData = await fallbackRes.json();
      console.log('Fallback total:', fallbackData.total);

      if (fallbackData.total > 0) {
        return res.json(categorizeIssues(fallbackData));
      }
    }

    res.json(categorizeIssues(issuesData));
  } catch (err) {
    console.error('Error fetching issues:', err);
    res.status(500).json({ error: 'Failed to fetch issues', details: err.message });
  }
});

// ─── Helper: Categorize issues by status ──────────────────
function categorizeIssues(issuesData) {
  const toDo = [], inProgress = [], done = [], blocked = [];

  if (issuesData.issues && issuesData.issues.length > 0) {
    issuesData.issues.forEach(issue => {
      const statusName = issue.fields.status?.name?.toLowerCase() || '';
      const statusCategory = issue.fields.status?.statusCategory?.key?.toLowerCase() || '';

      const item = {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.name,
        assignee: issue.fields.assignee?.displayName || 'Unassigned',
        priority: issue.fields.priority?.name || 'None',
        description: issue.fields.description,
        created: issue.fields.created,
        updated: issue.fields.updated
      };

      if (statusName.includes('block')) {
        blocked.push(item);
      } else if (statusCategory === 'done' || statusName === 'done') {
        done.push(item);
      } else if (statusCategory === 'indeterminate' || statusName === 'in progress' || statusName.includes('progress')) {
        inProgress.push(item);
      } else {
        toDo.push(item);
      }
    });
  }

  return { total: issuesData.total || 0, toDo, inProgress, done, blocked };
}

// ─── Debug endpoints ───────────────────────────────────────
app.get('/debug-jira', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const resources = await resourcesRes.json();

    const scopeRes = await fetch('https://api.atlassian.com/me', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const me = await scopeRes.json();

    res.json({
      user: me,
      accessibleResources: resources,
      cloudIdUsed: CLOUD_ID,
      cloudIdMatch: resources.some(r => r.id === CLOUD_ID)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug-projects', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/2/project`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    const data = await response.json();
    res.json({ count: Array.isArray(data) ? data.length : 0, projects: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug-issue/:issueKey', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/2/issue/${req.params.issueKey}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    res.json(await response.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug-permissions', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/2/mypermissions?permissions=BROWSE_PROJECTS,READ_PROJECT,VIEW_WORKFLOW_READONLY`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    res.json(await response.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`PitchYou backend running on port ${PORT}`);
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log(`Callback: ${CALLBACK_URL}`);
  console.log(`Cloud ID: ${CLOUD_ID}`);
});

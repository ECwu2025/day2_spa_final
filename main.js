// GenAI Finance course, starter scaffold.
// This file intentionally does very little. Build on it during class.
//
// No API keys are stored in this file. Both the Twelve Data key and the
// OpenRouter key are entered in the form fields at run time, so nothing secret
// is ever committed to your public repo or shipped in the source.

const form = document.getElementById('ticker-form');
const results = document.getElementById('results');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const twelveDataKey = document.getElementById('twelvedata-key').value.trim();
  const openRouterKey = document.getElementById('openrouter-key').value.trim();

  results.innerHTML = '<p>Loading...</p>';

  try {
    const priceData = await fetchPriceData(ticker, twelveDataKey);
    const note = await getResearchNote(ticker, priceData, openRouterKey);
    renderResults(ticker, priceData, note);
  } catch (err) {
    results.innerHTML = `<p class="error">Something went wrong: ${err.message}</p>`;
  }
});

// Twelve Data daily price history.
// This endpoint sends CORS headers, so it works directly from the browser.
// The free plan covers all US equities and ETFs (no ticker whitelist).
// Returns an array of daily bars sorted oldest to newest, each shaped as
// { date, open, high, low, close, volume } with numeric values.
// Replace or extend with moving average, MACD, RSI calculations from Day 1.
async function fetchPriceData(ticker, apiKey) {
  // outputsize is the number of most-recent bars. ~63 trading days is about
  // 3 months; 90 leaves a little headroom. Max allowed is 5000.
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=90&apikey=${apiKey}`;
  const response = await fetch(url);

  // Read the body as text first, then parse it safely, so an unexpected
  // non-JSON response gives a readable error instead of "Unexpected token".
  const body = await response.text();
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error(body.trim() || 'Price fetch failed');
  }

  // Twelve Data reports problems as { code, status: "error", message }.
  if (raw && raw.status === 'error') throw new Error(raw.message || 'Price fetch failed');
  if (!response.ok) throw new Error('Price fetch failed');

  // Successful responses look like { meta, values: [ { datetime, open, ... } ] },
  // newest first. Normalize to numbers and sort oldest to newest so indicator
  // math (moving averages, RSI, ...) reads left to right.
  const values = raw.values ?? [];
  if (!values.length) throw new Error(`No price data returned for ${ticker}`);

  return values
    .map((b) => ({
      date: b.datetime,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume)
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// OpenRouter call. The price data above is summarized and handed to the model
// so the note reflects the actual numbers you fetched. Replace the model,
// prompt, and system prompt with whatever you designed in the Prompt
// Engineering session.
async function getResearchNote(ticker, priceData, apiKey) {
  const first = priceData[0];
  const latest = priceData[priceData.length - 1];
  const pctChange = ((latest.close - first.close) / first.close) * 100;

  const summary =
    `${ticker} daily closes from ${first.date} to ${latest.date}: ` +
    `start $${first.close.toFixed(2)}, latest $${latest.close.toFixed(2)}, ` +
    `change ${pctChange.toFixed(1)}% over ${priceData.length} trading days.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-5',
      // Sonnet 5 is a reasoning model. If max_tokens is too small to also cover
      // its reasoning tokens, the request is rejected with a 400 "Provider
      // returned error". This note is short, so turn reasoning off and leave
      // comfortable headroom for the reply.
      max_tokens: 2000,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: 'You are a financial research assistant. Be concise and factual.' },
        { role: 'user', content: `${summary}\n\nWrite a one paragraph research note for ${ticker} based on this recent price action.` }
      ]
    })
  });
  // Surface what OpenRouter actually said, so a failed call tells you the real
  // reason (bad key, no credits, rate limit, provider error) instead of a
  // generic message you cannot act on.
  if (!response.ok) throw new Error(`OpenRouter call failed. ${await readOpenRouterError(response)}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
}

// Pulls the useful part out of an OpenRouter error response: the HTTP status,
// a plain-language hint for the common cases, and the message OpenRouter (or
// the upstream provider) actually returned.
async function readOpenRouterError(response) {
  let message = '';
  try {
    const body = await response.json();
    const err = body.error ?? body;
    message = err.message || '';
    // On a "Provider returned error", the provider's own message is under
    // metadata rather than the top-level message field.
    const provider = err.metadata?.provider_name;
    const raw = err.metadata?.raw;
    if (provider) message += ` [provider: ${provider}]`;
    if (raw) message += ` ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
  } catch {
    // Response body was not JSON; the status code below still says something.
  }
  const hint = {
    401: 'Your API key looks invalid or missing',
    402: 'This model is paid and your OpenRouter account is out of credits',
    429: 'Rate limited, wait a moment and try again'
  }[response.status];
  return [`(HTTP ${response.status})`, hint, message].filter(Boolean).join(' ');
}

function renderResults(ticker, priceData, note) {
  // priceData is sorted oldest to newest, so the last bar is the most recent.
  const latest = priceData[priceData.length - 1];

  results.innerHTML = `
    <h2>${ticker}</h2>
    <p class="price">Latest close (${latest.date}): $${latest.close.toFixed(2)}</p>
    <p class="note">${note}</p>
  `;
}

const conversations = {};

const SYSTEM_PROMPT = `You are LockIn AI, a no-nonsense study accountability coach. You help students stay consistent with their study goals. You are direct, honest, and supportive but you never let people make excuses. You are like a strict but caring coach who genuinely wants them to succeed.

Rules:
- Keep ALL responses SHORT. 2-4 sentences max.
- Be direct and human. No bullet points, no long lists.
- If they say they studied, celebrate briefly then push them forward.
- If they say they skipped, be firm but not harsh about getting back on track.
- Ask follow up questions to understand their goals better.
- End with a short question or action to keep the conversation going.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { sessionId, message } = req.body;

  if (!sessionId || !message) return res.status(400).json({ error: 'Missing fields' });

  if (!conversations[sessionId]) conversations[sessionId] = [];
  conversations[sessionId].push({ role: 'user', content: message });
  if (conversations[sessionId].length > 20) {
    conversations[sessionId] = conversations[sessionId].slice(-20);
  }

  // Build Mistral instruct prompt
  let prompt = `<s>[INST] ${SYSTEM_PROMPT} [/INST]</s>\n`;
  for (const msg of conversations[sessionId]) {
    if (msg.role === 'user') {
      prompt += `[INST] ${msg.content} [/INST]`;
    } else {
      prompt += ` ${msg.content} </s>\n`;
    }
  }

  try {
    const hfRes = await fetch(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 150,
            temperature: 0.7,
            return_full_text: false,
          },
        }),
      }
    );

    const data = await hfRes.json();

    if (!hfRes.ok || data.error) throw new Error(data.error || 'HF API error');

    let reply = data[0]?.generated_text?.trim();
    reply = reply.replace(/\[INST\].*?\[\/INST\]/gs, '').trim();
    if (!reply) throw new Error('Empty response');

    conversations[sessionId].push({ role: 'assistant', content: reply });

    res.status(200).json({ reply });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
}

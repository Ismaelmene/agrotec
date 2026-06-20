// Vercel Serverless Function — gera formulação de ração via Claude (Anthropic)
// Caminho: /api/formular.js

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).send(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!ANTHROPIC_KEY) {
    res.status(200).send(JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Vercel.' }));
    return;
  }

  try {
    const { prompt, fotoBase64 } = req.body;
    if (!prompt) {
      res.status(400).send(JSON.stringify({ success: false, error: 'prompt obrigatório' }));
      return;
    }

    const content = [];
    if (fotoBase64) {
      const match = fotoBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (match) {
        content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
      }
    }
    content.push({ type: 'text', text: prompt });

    // Tenta até 3 vezes em caso de erro transitório (502/503/529 - sobrecarga temporária)
    let anthropicRes, responseText;
    const maxTentativas = 3;
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          messages: [{ role: 'user', content }]
        })
      });

      responseText = await anthropicRes.text();

      // Status que valem retry: 502, 503, 529 (sobrecarga/instabilidade temporária)
      const statusTransitorio = [502, 503, 529].includes(anthropicRes.status);
      if (anthropicRes.ok || !statusTransitorio || tentativa === maxTentativas) break;

      await new Promise(r => setTimeout(r, 1500 * tentativa)); // espera crescente entre tentativas
    }

    let data;
    try { data = JSON.parse(responseText); } catch {
      res.status(200).send(JSON.stringify({ success: false, error: 'Servidor da IA instável (resposta não-JSON). Tente novamente em alguns segundos.' }));
      return;
    }

    if (!anthropicRes.ok) {
      const msgAmigavel = [502, 503, 529].includes(anthropicRes.status)
        ? 'Servidor da IA está temporariamente sobrecarregado. Tente novamente em alguns segundos.'
        : `Anthropic HTTP ${anthropicRes.status}: ${responseText.slice(0,300)}`;
      res.status(200).send(JSON.stringify({ success: false, error: msgAmigavel }));
      return;
    }

    const texto = data.content?.[0]?.text || '';
    const cleanJson = texto.replace(/```json|```/g, '').trim();

    let resultado;
    try {
      resultado = JSON.parse(cleanJson);
    } catch {
      res.status(200).send(JSON.stringify({ success: false, error: 'IA não retornou JSON válido: ' + cleanJson.slice(0,300) }));
      return;
    }

    res.status(200).send(JSON.stringify({ success: true, resultado }));

  } catch (e) {
    res.status(200).send(JSON.stringify({ success: false, error: 'Exceção: ' + e.message }));
  }
};

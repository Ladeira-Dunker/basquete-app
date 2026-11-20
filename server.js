const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const host = "127.0.0.1";
const port = Number(process.env.PORT) || 3000;
const pagePath = path.join(__dirname, "index.html");
const staticAssets = new Map([
  ["/manifest.webmanifest", {
    file: "manifest.webmanifest",
    contentType: "application/manifest+json; charset=utf-8",
    cacheControl: "no-cache"
  }],
  ["/sw.js", {
    file: "sw.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache"
  }],
  ["/community.js", {
    file: "community.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache"
  }],
  ["/supabase-config.js", {
    file: "supabase-config.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache"
  }],
  ["/icons/icon.svg", {
    file: path.join("icons", "icon.svg"),
    contentType: "image/svg+xml",
    cacheControl: "public, max-age=31536000, immutable"
  }],
  ["/icons/icon-192.png", {
    file: path.join("icons", "icon-192.png"),
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable"
  }],
  ["/icons/icon-512.png", {
    file: path.join("icons", "icon-512.png"),
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable"
  }]
]);
const geminiEndpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const defaultModel = "gemini-flash-lite-latest";
const maxBodyBytes = 32 * 1024;
const maxConversationCharacters = 24000;

const systemInstruction = [
  "Você é um assistente de treino de basquete, acolhedor e prático. Responda sempre em português do Brasil.",
  "Ajude a pessoa a montar e ajustar um treino conforme objetivo, tempo, espaço, equipamento e como ela está se sentindo.",
  "Quando ela mudar de ideia ou relatar cansaço, revise o plano atual em vez de insistir no plano anterior. Se estiver apenas cansada, sugira reduzir volume/intensidade e escolha atividades adequadas ao que ela relata.",
  "Quando fizer sentido, organize a sugestão em aquecimento, exercícios com séries/repetições ou duração, pausas e uma alternativa mais leve. Não invente informações sobre a pessoa; faça uma pergunta curta se faltar algo essencial.",
  "Não faça diagnóstico nem recomende treinar através de dor, lesão, tontura ou mal-estar. Nesses casos, recomende interromper a atividade e buscar orientação de um profissional qualificado.",
  "As sugestões são gerais e não substituem a orientação de um treinador ou profissional de saúde."
].join(" ");

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) chunks.push(chunk);
    });

    request.on("end", () => {
      if (tooLarge) {
        reject({ statusCode: 413, message: "A mensagem ficou grande demais. Envie uma mensagem menor." });
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject({ statusCode: 400, message: "A solicitação não contém JSON válido." });
      }
    });

    request.on("error", reject);
  });
}

function getConversationText(messages) {
  return messages
    .map((message) => `${message.role === "assistant" ? "Treinador" : "Jogador"}: ${message.content}`)
    .join("\n\n");
}

async function handleCoach(request, response) {
  if (!process.env.GEMINI_API_KEY) {
    sendJson(response, 503, {
      error: "A IA ainda não está configurada. Crie o arquivo .env com sua chave do Gemini e reinicie o servidor."
    });
    return;
  }

  if (!request.headers["content-type"]?.includes("application/json")) {
    sendJson(response, 415, { error: "A solicitação precisa usar o formato JSON." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.statusCode || 400, {
      error: error.message || "Não foi possível ler a solicitação."
    });
    return;
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    sendJson(response, 400, { error: "Envie pelo menos uma mensagem para o treinador." });
    return;
  }

  const messages = body.messages;
  let conversationCharacters = 0;

  for (const message of messages) {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.trim().length === 0 ||
      message.content.length > 4000
    ) {
      sendJson(response, 400, { error: "Uma das mensagens está vazia ou fora do formato esperado." });
      return;
    }

    conversationCharacters += message.content.length;
  }

  if (conversationCharacters > maxConversationCharacters) {
    sendJson(response, 413, { error: "A conversa está longa demais para uma solicitação. Comece uma nova conversa." });
    return;
  }

  let apiResponse;
  try {
    apiResponse = await fetch(geminiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: process.env.GEMINI_MODEL || defaultModel,
        system_instruction: systemInstruction,
        input: getConversationText(messages),
        store: false
      }),
      signal: AbortSignal.timeout(45000)
    });
  } catch (error) {
    console.error("Gemini connection failed:", error.name, error.message);
    const timedOut = error.name === "TimeoutError";
    sendJson(response, timedOut ? 504 : 502, {
      error: timedOut
        ? "O Gemini demorou demais para responder. Tente novamente."
        : "Não foi possível conectar ao Gemini. Confira a internet e tente novamente."
    });
    return;
  }

  let result;
  try {
    result = await apiResponse.json();
  } catch (error) {
    console.error("Gemini returned an unreadable response:", error.message);
    sendJson(response, 502, { error: "O Gemini respondeu em um formato inesperado. Tente novamente." });
    return;
  }

  if (!apiResponse.ok) {
    console.error(`Gemini request failed with HTTP ${apiResponse.status}.`);
    if (apiResponse.status === 429) {
      sendJson(response, 429, { error: "O Gemini informou que a cota ou a velocidade de uso foi atingida. Confira os limites da sua conta." });
      return;
    }
    if (apiResponse.status === 401 || apiResponse.status === 403) {
      sendJson(response, 502, { error: "O Gemini recusou a chave ou o acesso ao modelo. Confira a configuração no AI Studio." });
      return;
    }
    sendJson(response, 502, { error: `O Gemini não aceitou a solicitação (HTTP ${apiResponse.status}). Confira a chave e o modelo configurado.` });
    return;
  }

  const reply = (result.steps || [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!reply) {
    console.error("Gemini completed without a text response.");
    sendJson(response, 502, { error: "O Gemini não retornou uma resposta em texto. Tente novamente." });
    return;
  }

  sendJson(response, 200, { reply });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${host}:${port}`);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const page = await fs.readFile(pagePath);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(page);
    } catch (error) {
      console.error("Could not read index.html:", error.message);
      sendJson(response, 500, { error: "Não foi possível abrir a página do app." });
    }
    return;
  }

  const asset = staticAssets.get(url.pathname);
  if (request.method === "GET" && asset) {
    try {
      const contents = await fs.readFile(path.join(__dirname, asset.file));
      response.writeHead(200, {
        "Content-Type": asset.contentType,
        "Cache-Control": asset.cacheControl,
        "X-Content-Type-Options": "nosniff"
      });
      response.end(contents);
    } catch (error) {
      console.error(`Could not read ${asset.file}:`, error.message);
      sendJson(response, 500, { error: "Não foi possível abrir um recurso do app." });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, {
      configured: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL || defaultModel
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/coach") {
    await handleCoach(request, response);
    return;
  }

  sendJson(response, 404, { error: "Página ou rota não encontrada." });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("Request failed:", error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "O servidor encontrou um erro inesperado." });
    } else {
      response.destroy();
    }
  });
});

server.listen(port, host, () => {
  console.log(`Quadra disponível em http://${host}:${port}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log("Gemini sem chave: configure GEMINI_API_KEY no arquivo .env para ativar a IA.");
  }
});
